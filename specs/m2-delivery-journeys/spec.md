# M2 reviewed-delivery journeys

## Goal

Graduate M2 with one useful Coding delivery and one useful non-Coding delivery that each remain on
the same durable ForkLight Task lineage across an intentional daemon restart, then pass independent
verification, the frozen Judge requirement, Main review, safe Integration, and terminal workspace
disposition. Worker owns ordinary research, editing, self-check, and correction; Main owns the
contract, interruption observation, review decision, and serial Integration.

This spec is subordinate to the single project Goal in
`goals/forklight-main-led-execution/contract.md`. It is not a second roadmap or evidence system.

## Current evidence and selected user results

M2-A, M2-B, and M2-C have graduated. Focused inspection of the remaining M2 delivery chain found:

- Worker Tasks already have durable restart continuation, but a daemon restart after Integration
  has durably recorded `source-applied` still leaves the operation `outcome-unknown`; no safe
  continuation exists even for a source-only delivery with no build or activation commands.
- `docs/operations.md` documents individual commands, but there is no concise Main-led runbook that
  joins Goal submission, restart continuation, verifier, Judge, correction/reuse, Main review,
  Integration observation, and terminal storage disposition into one operator journey.

The two original accepted Work Items are:

1. [`coding-source-only-integration-recovery`](work-items/coding-source-only-integration-recovery/spec.md)
   — add a bounded safe continuation for the concrete source-only Integration crash window.
2. [`noncoding-main-led-runbook`](work-items/noncoding-main-led-runbook/spec.md) — publish one
   accurate end-to-end local operator runbook after the recovery behavior is integrated.

The non-Coding runbook later stopped before Integration on a product admission defect exposed by
its supported cross-Runtime handoff. 一骏 authorized two additional strict-serial Work Items rather
than historical relabeling or manual documentation application:

3. [`handoff-destination-execution-truth`](work-items/handoff-destination-execution-truth/spec.md)
   — make newly authorized Goal/Competition successors freeze execution truth from their selected
   destination Profile and Runtime, then pass two Judges, Main Integration, and zero-change audits.
4. [`noncoding-exact-candidate-recovery`](work-items/noncoding-exact-candidate-recovery/spec.md)
   — only after item 3 graduates, materialize the exact verified three-path runbook Candidate,
   obtain one fresh Judge, integrate it, and reuse the original three audits.

Both recovery Items then completed. The first terminal storage preview exposed one last M2-C
disposition blocker in the shared classifier:

5. [`resolved-terminal-storage-disposition`](work-items/resolved-terminal-storage-disposition/spec.md)
   — make a valid explicit Main terminal resolution outrank only stale Candidate review/Main/
   Integration wait packets after active and durable-evidence safety guards, then pass two Judges,
   Main Integration, zero-change audits, and an exact six-Task reclaim.

## Dependency and orthogonality decision

The writable paths are physically disjoint: Coding is limited to Integration/coordinator source and
focused tests; non-Coding is limited to `README.md` and `docs/`. Their validation surfaces are also
independent: behavioral tests versus documentation build/link/command review.

They are **not semantically orthogonal**. The runbook must describe the delivered recovery boundary
and must not promise behavior that is still only a Candidate. Therefore `noncoding-main-led-runbook`
depends on the Coding Work Item's accepted and activated Integration. They run serially. Main also
integrates every Candidate serially.

The two recovery Items are also non-orthogonal despite disjoint code/documentation paths: exact
Candidate recovery requires the activated destination execution truth and its audit result. They
run strictly serially after the stopped runbook lineage, with no concurrent product Writer.

The final storage-disposition supplement consumes both completed recoveries and changes the same
M2-C classifier used for terminal Workspace handling. It therefore starts only after their
Integration/audits and runs as one serial Writer plus read-only serial audits. Main alone performs
the exact real-home preview/reclaim and final evidence update.

## Shared execution contract

- Run `forklight health --json` before submission. Grok 4.6 Xhigh remains preferred, but a known
  authentication-missing Provider is not probed repeatedly. Use one currently smoke-proven healthy
  alternative and record its real execution mode.
- Each implementation Task has no absolute duration, Token ceiling, or no-progress timeout. One
  intentional confirmed daemon restart occurs only after the Task has produced a useful partial
  edit or narrower finding. Main then observes the same Task and Session lineage continue; it does
  not recreate or reroute the Task.
- Worker self-check is followed by ForkLight acceptance. Coding requires two independent read-only
  Judges because it changes Integration/recovery. Non-Coding requires one independent read-only
  Judge. Main decides and uses safe Integration.
- A correction reuses the same accepted paths and latest Candidate. Two rounds with the same failure
  or no material evidence, compensating patches, source drift, or a required scope expansion stop
  the Work Item with a decision packet.
- No Hub/UI, other product repository, Provider credential, commit, push, lock, lease, checksum,
  content-addressed manifest, version handshake, or distributed coordination is in scope.
- Protect active, reviewing, unresolved, and reusable-partial workspaces. After terminal delivery,
  use the product audit/preview/reclaim path under the existing authorization, preserve durable
  evidence, and require Store integrity `ok/0` with no unknown orphan.

## M2 journey acceptance

- One Coding Task and one non-Coding Task each show one pre-restart useful partial result, one
  `system-daemon-restart` continuation on the same Task lineage, and terminal Worker completion.
- Each Candidate passes its Work Item commands independently, its required Judges, Main review,
  safe Integration, and integrated-source audit.
- Main does not edit either ordinary Candidate.
- Runtime mode, Attempts, Candidate revision, verification, reviews, Main decision, Integration,
  and workspace disposition are traceable from durable ForkLight truth.
- `npm run check` passes at the M2 boundary; storage audit reports integrity `ok/0`, no unknown
  orphan, and no unexplained process.
- Compact evidence is written only to
  `goals/forklight-main-led-execution/evidence/m2-delivery-graduation.md` by Main after both journeys
  finish.
