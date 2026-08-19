# M2 foreground-Planner storage recovery — Main decision packet

Date: 2026-08-15 (Asia/Shanghai)

## Outcome

The authorized foreground-Planner boundary solved the prior Runtime failure. One real Grok CLI
4.6 Xhigh `/goal` created a non-empty Task-local plan, completed one classifier run and durably
ended `complete` with verdict `achieved`. The exact frozen storage Candidate then passed ForkLight
independent verification. The Work Item nevertheless stopped before Integration because its
immutable high-risk gate required two usable independent Judge opinions and the second Judge
returned a schema-invalid result. The contract authorizes no replacement Judge or fallback.

Main bound the exact Candidate to `reject`. No Integration, activation, downstream audit or reclaim
occurred.

## Frozen identity and Candidate

- Task: `6fbf8e70-a48a-4e7b-8cb8-3dc07e836085`
- Session: `76c834d2-315a-466f-a978-3ee30415c490`
- Attempt: `de6d0576-bae7-441a-9467-47e698e5e867` (one of one)
- Candidate Revision: `d6c85d59-10dc-4325-a0fc-e627b62130c2`
- Full Candidate/result diff sha256:
  `48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`
- Changed paths: `src/core/storage-lifecycle.ts`, `tests/storage-lifecycle.test.ts`
- Changed surface: two files, 181 lines
- Runtime: `grok-build/xai/grok-4.6/xhigh`, Grok CLI `1.0.4` commit `d846eb93d94d`
- ForkLight truth remains `persistent-session`; the operational wrapper, not the integrated product
  adapter, invoked native `/goal` with current-model-only.

The Candidate digest is byte-identical to frozen source Revision
`172d6a80-bdd7-487a-9e97-b938a67f10c5` and every earlier reusable storage Candidate. No Worker
mutator changed Candidate bytes.

## Native Goal hard gate

Native Goal `e1941538-caf8-4c0b-bdf1-5c5241bf3476` passed the gate that failed in both predecessor
Work Items:

- `plan.md` is non-empty at 7,281 bytes;
- `classifier_runs_attempted` is 1;
- durable status is `complete`, phase `Idle`;
- `last_classifier_verdict` is `achieved`;
- the durable classifier details file begins `Goal verification — Achieved` and records 0 of 3
  skeptics refuting the inspect-only delivery;
- the foreground wrapper policy exposed `Agent`, `search_replace/write` and read tools, removed
  `get_task_output/kill_task/wait_tasks/run_terminal_cmd`, denied Bash and Candidate Workspace
  `Write/Edit`, protected Runtime files and set `GROK_GOAL_USE_CURRENT_MODEL_ONLY=1`.

This proves the three removed background controls were the prior Planner initialization blocker.
It does not relabel ForkLight's product execution mode as `native-goal`.

## ForkLight independent verification

Verification event sequence 1899 passed all six accepted commands:

1. foreground wrapper policy test;
2. exact seed sha256;
3. reverse-apply proof;
4. `npm run build`;
5. the original storage/daemon/CLI/MCP focused suite (321 tests);
6. `git diff --check`.

ForkLight captured source-compatible unrelated drift separately. The Candidate lineage is complete:
one Attempt, one verified Revision, no correction, two files and 181 changed lines.

## Independent review and Main decision

Review Graph `c9721c94-9740-4ff2-9502-b26ce8a75a9c` was frozen to Candidate Revision
`d6c85d59-10dc-4325-a0fc-e627b62130c2` and verification sequence 1899.

- Codex Luna Max Judge Task `6f4a502d-93c8-4416-84f9-3a434d29c6b8` returned one usable
  `accept`, finding no violation of lifecycle ordering, Revision proof or the accepted boundary.
- DeepSeek Flash 1M Judge Task `2db8492d-9e19-4707-9c05-2a132480320f` completed its Worker Task but
  its Review result violated the required schema. ForkLight correctly marked it unusable; it is not
  a second opinion and cannot be counted as acceptance.

The aggregate is `single-opinion`, one usable and one unusable. Because the accepted Spec requires
two usable independent opinions and explicitly forbids replacement review or fallback, Main recorded
`reject` bound to Attempt `de6d0576-bae7-441a-9467-47e698e5e867`, verification sequence 1899,
Revision `d6c85d59-10dc-4325-a0fc-e627b62130c2` and the full digest above.

## Non-actions and workspace disposition

No extra Attempt, validation repair, correction, reverification, adaptation, handoff, reroute,
model switch, replacement Judge, second Review Graph, Integration, activation, audit, manual patch,
reclaim, commit or push occurred.

The Task space remains protected. Preview reports 139,071,602 total bytes:

- 134,987,714 regenerable bytes;
- 4,083,888 durable bytes;
- 0 unknown bytes;
- 0 attached processes;
- Store quick check `ok`, 0 foreign-key violations.

The current integrated classifier still reports `awaiting-required-review`, so the Workspace is
correctly retained until Main has new authority. The read-only global audit observation timed out;
that observation did not change Task or storage state.

## Economics

Worker usage is incomplete: one sample is missing, so observed zero Token counters are not claimed
as measured zero. ForkLight reports a low-confidence Main exchange estimate of 157,918–958,272
tokens. No Main Token reduction or direct-Codex saving is available.

## Decision required

This Work Item is terminal. Its useful outputs are the exact verified Candidate, successful native
Goal evidence and one usable Judge acceptance. M2 remains open and M3 remains closed. Continuing
requires a new M2 Milestone-level decision about a bounded review-only completion path for this
exact Revision. This packet does not authorize another Judge, new Task, retry, Candidate execution,
model switch, Integration or reclaim.

## Focused review-only feasibility audit

The current product cannot execute a simple "add one replacement Judge" decision against this
Revision:

- `createReviewGraph` permits exactly one graph per Candidate Revision. Repeating the same ordered
  Profile set is idempotent; a changed, reordered or larger set is rejected before mutation.
- The graph permanently freezes two assignments and reconciles each terminal reviewer Task once.
  A failed assignment is never reparsed, retried, replaced or appended.
- Reviewer Tasks freeze `baseMaxAttempts: 1`, `maxExtraAttempts: 0`,
  `maxMainCorrections: 0` and `maxAdaptationRounds: 0`.
- Integration separately requires two usable terminal opinions, so a later Main `accept` cannot
  override the missing opinion.

The failed DeepSeek result is substantively complete. Its terminal result is one otherwise
schema-shaped `accept` object for the exact Revision; the sole parser failure is a 507-character
`summary` against the frozen 500-character limit. It has the exact five root fields, two bounded
findings, safe relative evidence paths and the correct Revision id. Main still must not trim or
reinterpret it because the Judge contract froze the 500-character schema.

This is the third real occurrence on this same M2 storage chain, not a theoretical edge:

- DeepSeek Pro: otherwise-shaped result, summary 558 characters;
- MiniMax M3: otherwise-shaped result, summary 733 characters;
- DeepSeek Flash 1M: otherwise-shaped result, summary 507 characters.

All three were correctly rejected as `schema-violation`; in each round Codex returned one usable
accept. Creating another exact Candidate only to obtain another graph would repeat already proven
Worker/native-Goal/verification work and would not repair the product's review-output recovery gap.

The smallest aligned product option is an explicit, one-shot Judge result repair path. It would
keep the original failed assignment immutable, bind a schema-only correction to the same Judge
Profile, Candidate Revision and private packet, permit no Candidate access or model switch, and
count at most one corrected schema-valid result as that same independent opinion. It must require
Main confirmation, preserve both original and corrected evidence, reject stale/unsafe/wrong-identity
failures, and never run automatically. This is new M2 product behavior and requires a new accepted
Work Item before implementation; it is not authorized by this packet.
