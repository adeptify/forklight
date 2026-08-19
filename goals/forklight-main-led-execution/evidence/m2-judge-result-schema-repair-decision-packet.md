# M2 one-shot same-Judge schema-only result repair — decision packet

Date: 2026-08-15

## Outcome

The product implementation is reusable and independently verified, but the Work Item stopped
before Integration because only one of the fixed two Judge results was usable. The original storage
Candidate was not rerun and its failed DeepSeek assignment was not repaired.

## Reusable implementation evidence

- ForkLight Task: `b4d1fcab-215d-498f-bf8c-486ff1cc20b7`
- Session: `3f2b3843-4744-41d8-98ae-993285b2e889`
- Initial Attempt: `74a50595-feb3-44d2-a709-dd1a0ee2d2c7`
- Explicit Main-correction Attempt: `94a7f02b-3b45-4804-9791-aa676f0414fd`
- Native implementation Goal: `9cdfd2f5-e366-45c4-9812-01a1893b40dd`, terminal `achieved`
- Native correction Goal: `9be4561a-d7eb-41da-a44d-ab58f33d18af`, terminal `achieved`
- Final Candidate Revision: `3fb7d72d-7d19-4b34-b2ff-42dd108429f3`
- Candidate digest: `4f746b2e73df3e0f8b1037e70f6fad36c75045b1f4403e348f69e363ef68809a`
- Independent verification event: sequence 13330; build, 441 focused tests and diff check passed.
- Candidate paths: the 16 product/test paths listed in the accepted Work Item Spec; no storage
  Candidate path, native-Goal Candidate path, Hub/UI path or Goal SSOT path is in the Candidate.

Main's initial `revise` identified three concrete blockers: the public parser could relax the
summary bound, unavailable private packets did not fail closed before mutation, and human CLI
status omitted repair lifecycle. The single correction closed all three. Main then rechecked the
actual final diff for strict summary-only admission, immutable original evidence, same frozen
identity, one Attempt with zero fallback, exact packet-byte copying, semantic-drift rejection,
restart recovery, fresh-Main evidence, Integration gate and privacy-safe status.

## Fixed Judge evidence

- Review Graph: `02427b99-cf08-4283-9c5f-7cd51948aa9e`
- Codex Luna Max assignment: `faf2f463-5833-4242-896b-7047ae8371d5`; reviewer Task
  `b134a754-aff1-430d-84b4-08161bf79f14`; usable `accept`.
- Volcengine GLM 5.2 assignment: `4bab381d-45d2-4aa6-9da1-5901fdc839db`; reviewer Task
  `3b45949d-1420-4ada-bc44-7e3c3e1ee543`; Task succeeded but result was classified
  `extra-fields`, unusable.
- Aggregation: `single-opinion`, 1 usable and 1 unusable. Integration remains blocked and fresh
  Main review is required by product truth.

The unusable result contains a malformed/extra structured field. It is not the eligible defect
this Candidate implements: an otherwise-valid exact-Revision result whose only problem is summary
length. No raw Judge text or private Review Packet is reproduced here.

## Actions deliberately not taken

- No Candidate rerun, correction beyond the one already consumed, adaptation or replacement Task.
- No Judge identity switch, third/replacement Judge or automatic retry.
- No Main accept, Integration, activation or source-worktree application.
- No invocation against storage assignment `16123390-e749-466b-a53c-2035913defa8`.
- No storage Workspace reclamation, historical deletion, commit, push, Hub/UI or M3 work.

## Workspace disposition

Keep the implementation Task Workspace, both reviewer Workspaces, the original two-path storage
Candidate Workspace and their durable Store evidence protected. They contain reusable exact
Candidates and unresolved review evidence. No destructive cleanup is authorized.

## Remaining gap and required decision

M2 still lacks an integrated way to recover the original 507-character DeepSeek opinion. To
continue, 一骏 must make a new explicit Milestone-level decision. The safe default is to keep this
chain stopped. Any alternative would broaden a frozen boundary—for example accepting a high-risk
Candidate with one usable Judge or designing a separately specified same-identity repair for a
different exact schema defect—and must be authorized as new scope rather than treated as a retry.

## 2026-08-16 authority update

一骏 subsequently authorized the first named alternative: a one-time 1-Judge delivery exception for
the exact already-verified Candidate. This authority does not make the Volcengine result usable and
does not mutate the frozen Task requirement. Main's controlled apply must retain the exact Revision,
digest and accepted paths; prove normal ForkLight preflight differs only at the waived review-depth
gate; reproduce all remaining safety checks; pass the accepted suite and full check; and record the
absence of a ForkLight Integration result for this exceptional apply. The real storage repair and
its unchanged two-Judge gate remain downstream.

## Orthogonal-ready-wave audit

A focused current-state audit found no already-authorized orthogonal Writer that can move M2 while
this chain waits. Native `/goal` Task `010812a2-0939-4315-9e19-ae7b892e677b` has a verified
14-path Candidate and two usable accepts, but Main correctly recorded `revise`: neither the current
product source nor that protected Candidate sets `GROK_GOAL_USE_CURRENT_MODEL_ONLY=1`; only the
project-local operational bootstrap does. The original Task has exhausted its validation repair
and Main correction. Starting another product Task for that one missing launch invariant also
requires a new explicit bounded authorization. Storage audits and reclamation remain downstream of
the unresolved Integration chain, so running them now would not produce graduation evidence.
