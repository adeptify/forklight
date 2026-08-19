# M4-E focused audit — Main observation and resume overhead

Date: 2026-08-18 (Asia/Shanghai)

## Scope

This audit covers only the M4 delegated-Main path from Task submission to reviewed delivery. It
does not inspect private Codex history, Provider credentials, unrelated repository modules or Hub/UI.

## Observed symptom

The two accepted M4-D pairs have non-lower delegated Main Token even though their Workers passed
independent verification, two Judges, Main acceptance and safe Integration:

- `worker-runtime`: direct 152,271 versus delegated 2,401,089 gross Main Tokens;
- `hub-product-comprehension`: direct 119,202 versus delegated 2,128,876 gross Main Tokens.

Delegated cache-read Token dominates both results: 2,305,024 and 2,027,008, versus 132,352 and
100,096 direct. The storage pair is incomplete at review depth but shows the same direction.

## Current call-chain evidence

Public Task reports show 26 attributed ForkLight exchange receipts for the accepted
`worker-runtime` Task, 15 for the accepted Hub-comprehension Task and 13 for storage. Review Graph
create/status calls are separate public operations and are not included in those Task Token receipt
counts, so these are lower bounds on Main/ForkLight interaction boundaries rather than exact model
turn counts.

The current successful path is necessarily split across public calls:

1. submit the Task and observe Worker/verification progress;
2. inspect the Candidate and decision packet;
3. create the required Review Graph and observe each Judge to terminal;
4. inspect the exact Candidate plus Judge evidence and record Main's decision;
5. request Integration preflight, explicitly apply its receipt and observe the durable operation.

`forklight wait` observes only Task progress. `review-graph` has create/status but no wait-to-decision
operation. Main review, Integration preflight, apply and wait are separate. `inspect --summary`
already reuses the canonical `MainDecisionPacket`, but JSON output duplicates the full
`TaskDecisionView`, successful command stdout and Integration detail: on the accepted
worker-runtime Task, `--summary --events 0 --json` is 11,967 bytes while the bounded human summary
is 1,012 bytes. Output volume is a secondary cost; repeated Main re-entry is the primary supported
diagnosis because even the low-byte Hub exchange envelope accompanies more than two million gross
Main Tokens.

## Root cause and minimum complete product change

ForkLight has durable Task, Review Graph, Main review, preflight and Integration truth, but no
single public operation that advances deterministic steps until the next point where Main judgment
is actually required. Main therefore spends a model turn on observation and plumbing between every
durable state transition.

The minimum complete change is two resumable, bounded public delivery checkpoints that compose
the existing records without adding a new product entity:

- `delivery prepare`: submit a new Task or resume an existing Task, observe it without imposing a
  Worker deadline, create exactly the explicitly confirmed required Judge set after a verified
  Candidate exists, wait to a decision boundary, then return one compact Candidate/verification/
  Judge packet. It never decides, corrects or integrates.
- `delivery decide`: bind Main's explicit decision to the exact Candidate identity. Accept performs
  one fresh safe preflight and one Integration and observes the durable operation; revise/reject
  records only that decision. It never invents a decision, retry or fallback.

An observation timeout ends only the public observation call. The Task, Review Graph or Integration
continues from durable state and the same exact request can resume without duplicate Task, Judge
set, Main review, receipt or Integration operation.

## Existing behavior to reuse

- `MainDecisionPacket`, `TaskDecisionView` and current exact Candidate Revision/digest binding;
- idempotent same-revision, same-ordered-set Review Graph creation;
- current Worker validation repair and explicit Main correction policy, with no new automatic loop;
- current Main review, Integration preflight, apply, wait and rollback behavior;
- current CLI/MCP redacted exchange capture and source/Daemon identity checks.

## Rejected alternatives

- Changing model, effort or Judge depth would hide the measured product gap and violate pair quality.
- Replaying M4-D with the same granular workflow seeks a favorable number without changing behavior.
- Merely shrinking JSON output cannot remove the many Main re-entry points.
- Locks, leases, checksums, a delivery database entity or distributed workflow protocol are not
  needed for one local developer and would add cost without preventing a named failure.
- A project-only shell script would not provide the cross-project CLI/API capability required by
  the Goal.

## Next accepted boundary

Implement one serial M4-E Work Item, `specs/m4-e-main-efficient-delivery/spec.md`, through ForkLight
with Grok 4.6 Xhigh native Goal, independent verification, two different-view Judges and Main safe
Integration. After activation, generate fresh non-replay pair work using the new two-checkpoint
path; do not reopen or overwrite M4-D evidence.
