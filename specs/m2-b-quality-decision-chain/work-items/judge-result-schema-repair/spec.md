# M2-B Work Item — One-shot same-Judge schema-only result repair

## User result

When an otherwise valid read-only Judge opinion is rejected only because its summary exceeds the
published Review Result bound, Main can explicitly ask the same frozen Judge identity to shorten
that one field once. ForkLight keeps the original failed assignment and raw result immutable,
does not rerun or expose the Candidate, and counts the repaired JSON as the same independent
opinion only after strict validation proves that Revision, disposition and findings did not change.

## Background and current evidence

Review Graph currently freezes one to three assignments for one exact Candidate Revision. A
terminal assignment is parsed once; the same ordered Judge set is idempotent, a changed set is
rejected, and required-Judge Integration gates count only strict-parser successes. There is no
existing append, replacement or result-repair operation.

The current storage Candidate has one usable Codex opinion and one DeepSeek Flash opinion whose
Task succeeded. DeepSeek returned the exact five root keys, correct Revision, `accept`, safe
relative evidence paths and bounded findings; its summary is 507 characters against the published
500-character limit. Two earlier exact storage reviews produced the same otherwise-valid shape
with summaries of 558 and 733 characters. Re-running the Candidate or adding a different Judge
would repeat expensive work and change the independence contract instead of repairing the proven
schema boundary.

一骏 explicitly authorized this Work Item on 2026-08-15 with four hard constraints: do not rerun
the Candidate, do not switch Judge identity, do not add a third Judge, and do not automatically
retry. This Work Item is the unique accepted specification for that capability and its first real
use.

## `depends_on`

- Graduated M2-B Review Graph, review-requirement gate and Main decision packet behavior.
- Review Graph `c9721c94-9740-4ff2-9502-b26ce8a75a9c`, failed assignment
  `16123390-e749-466b-a53c-2035913defa8`, DeepSeek reviewer Task
  `2db8492d-9e19-4707-9c05-2a132480320f`, exact Candidate Revision
  `d6c85d59-10dc-4325-a0fc-e627b62130c2`, and its immutable private packet.
- ForkLight independently passed verification sequence 1899 for the exact two-path Candidate at
  digest `48a73c6b6db1071fd62f2dfffa3799df81805cdc1e6d4a46cb163bb9ebdafcda`.
- Current CLI/Daemon build identity matches and `grok-4-6-xhigh` is launchable.

## Inputs

- One explicit Candidate Task id, failed Review Assignment id, bounded Main reason and
  `confirm: true`.
- The original assignment, frozen Worker identity/Profile, original terminal Reviewer Task and
  latest raw result text already retained by ForkLight.
- The assignment's existing private Review Packet and published Review Result schema/bounds.

## Outputs

- One durable, append-only repair record attached to the existing assignment and one linked
  read-only repair Task using the same frozen Provider, model, Runtime, effort and Profile.
- A privacy-safe CLI/API/MCP projection of eligibility, repair lifecycle and final usable/unusable
  state without raw result, packet path, prompt, credentials or absolute paths.
- On success, one strict `ReviewResult` that changes only the over-limit summary; Graph Judge count
  remains unchanged and fresh repair evidence requires a later Main decision.
- On any ineligible or failed repair, the original unusable opinion remains unchanged and no
  follow-up work starts automatically.

## Accepted design and call chain

1. Main explicitly calls `review-graph repair-result` for one existing assignment. Admission is
   allowed only when the original Reviewer Task succeeded, the assignment is terminal failed with
   `failureCode: schema-violation`, no repair record exists, and the retained raw reply contains
   exactly one JSON object.
2. A narrow eligibility parser must prove that object already has the exact root/finding keys,
   schema version, Candidate Revision, disposition, safe content, relative evidence paths and
   bounded findings required by the strict parser. The only tolerated defect is `summary` length
   greater than 500 and within the existing total-result bound. Missing, malformed, extra-field,
   stale, wrong-identity, oversized-result, unsafe-content, failed-Task or any other schema shape
   is ineligible.
3. ForkLight appends one `resultRepair` record to the assignment without overwriting the original
   `status`, `failureCode`, original Reviewer Task id or raw Attempt evidence. Presence of that
   record permanently consumes the one-shot allowance, regardless of its terminal result.
4. ForkLight atomically registers a derived `allowEdits: false` repair Task, bound to the same
   frozen Judge identity/Profile and the same private packet. Its private project contains the
   original JSON and instructions to shorten only `summary`; it is linked to the original
   assignment and is never counted as another assignment or third Judge.
5. The repair Task has one base Attempt, no extra Attempt, correction, validation repair,
   reverification, adaptation, replacement or model switch. Daemon restart may only resume
   observation/queue recovery for that already durable Task; it must not create a second repair.
6. On terminal success, ForkLight runs the existing strict parser against the same exact Candidate
   Revision and repair Task identity, then additionally proves schema version, Revision,
   disposition and every finding equal the original eligible object. Only the bounded summary may
   differ. Failure stays durable and unusable.
7. A usable repair updates Graph evidence time and aggregation for the same assignment. It never
   records Main accept or integrates. Main must inspect the exact result and record a fresh
   decision before safe Integration.

## Allowed product paths

- `src/core/review-graph.ts`
- `src/core/review-result-repair.ts` if a focused module keeps the boundary clearer
- `src/core/types.ts`
- `src/state/store.ts`
- `src/daemon/protocol.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/server.ts`
- `src/cli.ts`
- `src/mcp/exchange-receipts.ts` only to register the new explicit MCP mutation receipt name
- `src/mcp/server.ts`
- `tests/review-graph.test.ts`
- `tests/store.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`
- `tests/integration.test.ts` only for the required-Judge gate regression

Main alone may update this Spec, the existing Goal SSOT, the operational Task contract and compact
evidence. Worker changes outside the product list are forbidden.

## Forbidden paths and non-goals

- Candidate product paths, Candidate Workspace, Candidate verification commands or Candidate
  Revision records; no Candidate rerun, edit, materialization, correction or new Candidate.
- New Review Graph, new assignment, changed/reordered Judge set, third Judge, replacement Judge,
  different Profile/Provider/model/Runtime/effort, Competition or majority vote.
- Automatic trigger, automatic retry, generic Reviewer Task retry, unbounded schema cleanup,
  deterministic silent truncation, or accepting a result that changes disposition/findings.
- Repair of malformed JSON, missing/extra fields, stale Revision, wrong identity, unsafe content,
  failed Reviewer Tasks, multiple objects or total-result oversize.
- Main decision, Integration, storage reclaim, historical mutation, commit, push, Hub/UI or M3.
- Locks, leases, checksums, content hashes, version handshakes, multi-user or distributed behavior.

## Acceptance

1. A real 507-character otherwise-valid summary is eligible; 500 characters is already valid and
   needs no repair; missing fields, extra fields, stale Revision, unsafe paths/content, malformed
   JSON and non-schema failures are rejected before durable mutation.
2. Explicit `confirm: true`, exact Candidate/assignment ownership and terminal succeeded Reviewer
   Task are mandatory. One existing repair record makes every later request fail closed without a
   new Task or Attempt.
3. The repair Task freezes the original Judge identity/Profile and private packet, is read-only,
   has exactly one base Attempt and zero fallback, and does not increment assignment/Judge count or
   Goal review rounds.
4. Original assignment status/failure/task/raw evidence remain readable and unchanged. Repair
   state survives Daemon restart and a stranded queued/running repair resumes the same Task.
5. A repaired result is usable only when the strict parser passes and only summary changed.
   Disposition/findings/Revision drift or another schema failure leaves it unusable permanently.
6. Review Graph status, required-Judge gate, decision packet, CLI status and MCP status agree on
   effective usability. A successful repair creates newer terminal review evidence and therefore
   requires a fresh Main decision before Integration.
7. CLI and MCP expose one explicit, confirmed operation and bounded privacy-safe result. No raw
   reply, private packet path, absolute path, prompt or credential appears.
8. The exact current DeepSeek assignment can be repaired once through the integrated product. No
   Candidate execution, Judge switch, third Judge or automatic follow-up occurs.

## Verification commands

```bash
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/review-graph.test.ts tests/store.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts tests/integration.test.ts
git diff --check
```

After safe product Integration and activation, Main exercises exactly one real repair against
assignment `16123390-e749-466b-a53c-2035913defa8`, waits on its durable Task/events, and verifies
the existing storage Candidate now has two usable opinions. The Candidate itself is not rerun.

## Parallelism and Integration

This is the only Writer. Its accepted product paths are disjoint from the protected storage
Candidate's two paths and from the protected native-Goal Candidate's frozen focus paths
(`src/workers/grok*`, execution-mode/settings, Runtime/Goal tests and three docs). Even though the
modification sets are orthogonal, both change M2 truth, so Main integrates serially. Judges are
read-only and begin only after ForkLight independent verification of one exact Revision.

## Review and handoff

This changes Review/Integration authority and restart recovery, so exactly two independent Judges
review the implementation Candidate: one for immutable evidence/one-shot/gate correctness, one for
privacy, restart and CLI/API compatibility. No third Judge or replacement is allowed. Main decides
from the accepted Spec, actual diff and machine verification.

Handoff includes implementation Task/Attempt/Session/native Goal ids; exact Candidate Revision,
digest and paths; verification; the two Judge opinions; Main decision and Integration; then the
single real repair Task/result, resulting Review Graph gate, storage Candidate decision state and
workspace disposition. It excludes raw private packets, raw Judge text and credentials.

## Workspace disposition and stop

Protect the implementation Workspace until verification, two Judges, Main decision and
Integration are durable. Protect the original storage Candidate and all review/repair artifacts
through its final decision. Stop this Work Item if two purposeful implementation rounds repeat the
same failure, the repair needs more than summary-only semantics, identity/Revision cannot be
proven, paths expand, either implementation Judge is unusable, or the one real repair fails. Do
not rerun the Candidate, switch Judge, add a third Judge or automatically retry. Historical six-
Task reclaim still requires its separate fresh preview and explicit destructive approval.

## Authorized one-time delivery exception — 2026-08-16

After three consecutive Milestone stop turns, 一骏 explicitly authorized Main's recommended option:
deliver exact Candidate Revision `3fb7d72d-7d19-4b34-b2ff-42dd108429f3`, digest
`4f746b2e73df3e0f8b1037e70f6fad36c75045b1f4403e348f69e363ef68809a`, with its one usable
Codex Luna Max opinion as a one-time exception. This does not reinterpret the Volcengine result as
usable, mutate the frozen `requiredJudges: 2`, create another Judge, or change the default policy.

ForkLight has no durable operation for lowering one already-frozen Task review requirement. Main
must therefore preserve Store history and may not edit the Task record. The exception is executed
as one controlled exact-patch Integration: record a fresh Main `accept` bound to verification
sequence `13330` and the exact Revision/digest; prove normal ForkLight preflight is rejected only by
the deliberately waived review-depth reason; independently reproduce patch digest, affected-path,
source-base, apply-check and accepted verification checks; apply that exact patch once; rebuild,
run the accepted suite and full high-risk check, activate the matching Daemon, and record that no
ForkLight Integration operation represents this exceptional apply.

This exception authorizes no general bypass, Store rewrite, hard-coded Task id in product code,
manual result fabrication, second exception, Candidate correction, new Judge, replacement Task,
commit, push, reclaim, Hub/UI or M3. After activation, the original storage assignment is repaired
through the integrated explicit product command. Its storage Candidate must still satisfy its own
two-usable-Judge gate before normal safe Integration.
