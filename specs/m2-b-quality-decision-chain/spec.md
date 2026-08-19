# M2-B — Risk-declared review and one Main decision packet

## User result

For one Candidate, Main can declare the required independent review depth before execution and
later read one plain-language decision packet that connects Worker self-check, ForkLight
verification, evidence-driven correction, Review Graph, partial reuse/handoff, Main decision, and
Integration. The packet names the missing evidence and one next action without starting it.

## Background and current evidence

ForkLight already has the necessary authorities as separate primitives:

- Worker prompts require self-check and ForkLight independently runs the stored acceptance suite.
- `worker-validation-repair` can return sanitized verification evidence to the same Worker Session
  under a frozen bounded allowance.
- Candidate Revision, structured correction, direct Goal handoff, and retained paths/gaps already
  preserve partial work.
- Review Graph can run one to three read-only Judges on one exact Candidate Revision; pending or
  terminal review without a fresh Main decision blocks Integration.
- Main Review binds modern decisions to an exact revision and verification; Integration performs
  safe preflight/apply.
- `TaskDecisionView` and compact inspect show much of the machine/decision lineage, while daemon
  full inspect separately exposes Review Graph. Compact CLI/MCP supervision drops Review Graph,
  handoff/reuse readiness, and the reason a review is required. A Main must mentally join several
  commands and can attempt Integration before creating any Review Graph because review depth is not
  frozen in the Task contract.

The gap is orchestration truth and a unified read projection, not rebuilding the primitives.

## `depends_on`

- M2-A accepted and integrated. M2-B consumes the final execution-mode types and public Task
  projections from M2-A.
- M2-B is serial before M2-C because both require shared Task types, daemon protocol/coordinator,
  CLI/MCP surfaces, and terminal eligibility facts.

## Scope

1. Add one optional immutable Task review requirement chosen explicitly by Main: required Judge
   count `0`, `1`, or `2`, plus a bounded reason. Do not infer risk from prose, file names, model,
   Task family, or diff size.
2. Preserve legacy Tasks with no requirement. A skipped review (`0`) must remain an explicit Main
   choice in new M2 Task contracts, not a silent claim that review was unnecessary.
3. Before Integration, enforce the frozen requirement against the current exact Candidate
   Revision: required graph exists, has at least the required independent assignments, is terminal,
   and is followed by a fresh Main accept. Existing Review Graph authority remains canonical.
4. Build one privacy-safe `Main decision packet` projection from existing durable truth. It must
   cover execution mode, Worker/self-check claim status, independent verification, validation
   repair/correction allowance and stop reason, review requirement, Review Graph opinions/state,
   Candidate reuse/handoff, current Main Review, Integration, blockers, and exactly one next Main
   action.
5. Use the same core projection for CLI compact inspect and MCP compact inspect. Daemon/API may
   return the structured packet. Presentation code translates closed facts; it never makes a new
   decision.
6. Keep corrections evidence-driven and bounded. The packet may recommend continuing the same
   Worker, handoff of named retained paths/gaps, accept, reject, Integration, wait, or stop, but may
   not execute any of them.

## Non-goals

- No automatic risk classification, Judge creation, replacement Judge, voting, majority decision,
  Worker-to-Worker dialogue, correction, retry, Competition, Main Review, or Integration.
- No new Review Graph implementation, Candidate entity, Work Item entity, scheduler, or parallel
  status system.
- No Hub/UI work before M5.
- No locks, leases, checksums, content addressing, cross-node version handshakes, or duplicated
  Candidate consistency checks. Existing exact Candidate Revision/source-base and Integration
  checks remain because they prevent wrong Integration.
- No credential access, commit, push, or remote mutation.

## Inputs, outputs, and dependencies

- Inputs: immutable Task review requirement; Task/Attempt/events; Candidate Revision; independent
  verification; validation-repair/correction eligibility; Review Graph projection; handoff record;
  Main Review; Integration results.
- Output: one bounded structured decision packet plus concise human rendering with evidence,
  blockers, stop reason, and one next action.
- Dependencies: existing canonical resolvers remain authoritative. The packet composes their
  outputs and must not reimplement their eligibility rules.

## Module and file boundaries

Allowed product paths:

- a new focused core decision-packet module if needed
- `src/core/types.ts`, `src/core/task.ts`, `src/core/task-preview.ts`
- existing `src/core/task-decision-view.ts`, `src/core/review-graph.ts`,
  `src/core/candidate-handoff.ts`, correction/reuse read projections, and Integration preflight only
  for the smallest required composition/gate
- `src/cli/supervision.ts`, `src/cli.ts`
- `src/daemon/protocol.ts`, `src/daemon/coordinator.ts`, `src/daemon/server.ts`
- `src/mcp/server.ts`
- focused tests for Task parsing, decision packet, Review Graph/Integration gate, CLI compact
  inspect, daemon, and MCP
- narrowly relevant operations documentation

Forbidden paths:

- `src/hub/**`
- Worker adapters, Provider/model routing, storage deletion/reclamation implementation,
  Competition scoring, economics, unrelated Goal/Plan scheduling
- current Goal SSOT and other Work Item specs (Main owns them)
- files outside the ForkLight project

## Call chain

1. Main freezes `requiredJudges` and its reason in the Task contract.
2. Worker executes and self-checks; ForkLight independently verifies and captures one exact
   Candidate Revision.
3. An eligible verification failure may return one sanitized bounded repair to the same Worker;
   otherwise evidence returns to Main.
4. Main creates the required read-only Review Graph on that exact revision.
5. The decision packet composes review requirement, graph, verification, reuse/handoff,
   correction, Main Review, and Integration truth.
6. Main records accept/revise/reject. Integration preflight admits only a fresh accept after the
   required review evidence.

## Scenarios

### Ordinary meaningful Task

Given `requiredJudges: 1`, when verification succeeds and no graph exists, then the packet says the
Candidate awaits one independent Judge and Integration preflight refuses it. After one usable
terminal Judge and a fresh Main accept, the packet says ready for Integration.

### High-risk Task

Given `requiredJudges: 2`, when only one Judge has completed, then the packet shows one missing
opinion and Integration remains blocked. Agreement or disagreement is evidence only; Main still
decides after both are terminal.

### Explicit mechanical skip

Given `requiredJudges: 0` with a bounded reason, when verification succeeds, then the packet shows
that explicit skip evidence and awaits Main Review. It never claims a Judge ran.

If an explicit-skip or legacy Task already has a canonical Review Graph, that graph keeps its
existing authority. A pending graph or terminal graph without a fresh following Main decision must
therefore make the packet recommend waiting for review or recording a fresh Main decision; it must
not recommend Integration merely because no nonzero requirement was declared.

### Verification failure with usable partial work

Given a Candidate Revision with some verified reusable paths and named remaining gaps, when repair
cannot continue inside the same spec, then the packet preserves the partial result and recommends
one explicit handoff/stop decision. It does not restart the whole Task or switch models.

### Repeated no-progress stop

Given two purposeful rounds repeat the same failure or add no material evidence, when the packet
is built, then it names the stop reason, completed/reusable output, remaining gaps, evidence,
attempted remedies, workspace disposition, and the decision Main must make.

## Acceptance criteria

- New Tasks can freeze required Judge count `0|1|2` plus a bounded reason; legacy Tasks remain
  readable and do not gain invented review requirements.
- Integration preflight blocks a missing, undersized, pending, stale, or not-followed-by-fresh-Main
  required Review Graph.
- One canonical structured packet covers every required quality/decision stage using existing
  authority sources and exactly one next action.
- The packet's one next action honors every canonical Review Graph blocker, including a graph on a
  legacy or explicit-skip Task; it never contradicts Integration preflight.
- CLI `inspect --summary` and MCP `forklight_inspect` summary expose the same packet semantics.
- Worker claims remain labeled unverified; Judge dispositions remain evidence; only Main Review
  authorizes Integration.
- Correction/reuse/handoff facts never launch work from a read path.
- No private prompt, raw patch, raw log, absolute artifact path, credential, or unbounded output is
  added to the packet.
- No Hub change or unrelated refactor appears.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/task.test.ts tests/task-preview.test.ts tests/task-decision-view.test.ts tests/review-graph.test.ts tests/integration.test.ts tests/cli-supervision.test.ts tests/daemon.test.ts tests/mcp.test.ts
git diff --check
```

Main also exercises one succeeded Candidate with the Work Item's two required independent Judges,
records a fresh Main decision, and verifies Integration preflight behavior before applying.

## Review and handoff

- This touches review and Integration authority, so use two independent read-only Judges with
  different viewpoints after ForkLight verification.
- Judge one focuses on evidence/authority correctness and stale-decision paths. Judge two focuses
  on privacy, compatibility, and whether the packet can mislead Main.
- Main resolves disagreement against this spec and actual evidence; no vote decides acceptance.
- Verified gaps return to the same Worker Session when the boundary remains valid. Do not add a
  third Judge unless the two reports expose a real unresolved disagreement.
- Final handoff contains the exact review requirement, Candidate Revision, verifier evidence,
  packet output, Judge reports, Main decision, Integration preflight result, remaining risk, and
  workspace disposition.

## Workspace disposition

- Protect the full Workspace and Candidate artifacts while verification, correction, Review Graph,
  Main Review, handoff, or Integration remains open.
- A reusable partial result stays protected until selected paths/gaps and successor preparation are
  durable.
- After accepted Integration and durable packet/Judge/Integration evidence, M2-C may reclaim only
  regenerable space.

## Assumptions, risks, and stop conditions

- Assumption: existing primitive eligibility resolvers are authoritative and can be composed
  without redesign.
- Risk: a packet can become a second decision engine. Mitigation: it carries closed results from
  canonical resolvers and one derived next action; it never mutates or authorizes.
- Risk: enforcing a new requirement could break legacy Integration. Mitigation: only new Tasks with
  an explicit requirement get the new missing-graph gate.
- Stop if the Worker needs a new scheduler/entity, automatic risk inference, Hub work, duplicate
  exactness protocol, or a wider authority redesign.
