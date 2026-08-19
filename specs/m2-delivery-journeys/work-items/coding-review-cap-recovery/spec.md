# M2 Coding journey — exact Candidate review-cap recovery

## User result

The already completed source-only Integration recovery Candidate is materialized unchanged into a
clean current-source ForkLight Workspace, independently re-verified, reviewed by two fresh Judges,
and—only if both opinions are usable and Main accepts the exact Revision—safely integrated. This
recovers missing review evidence; it does not reopen implementation or change product behavior.

## Background and authority

The accepted behavior contract remains
`specs/m2-delivery-journeys/work-items/coding-source-only-integration-recovery/spec.md`. Original
Goal `execution/m2-coding-journey/goal.json` stopped at its frozen two-round Review Graph cap after
one same-Session correction and one supported one-hop handoff. Final successor Task
`b5c29d35-e69e-47a0-b2c6-00acd92b8cdb` produced Revision
`ebd14c70-400f-4f99-aab6-adc938e54938`, full patch digest
`a862bfe4abcec99ae32e364ae7df12eb85a30e15d3d65bce67965cbfe054f651`, four accepted paths, and a
passing independent verifier. The Candidate has no usable exact-Revision Judges because the prior
Goal cap was consumed by older and malformed review outputs. 一骏 explicitly authorized this narrow
recovery on 2026-08-14.

The exact digest check exists solely to prevent materializing or integrating the wrong Candidate or
source base. It is not a new product checksum protocol, manifest, lock, lease, or version handshake.

## `depends_on`

- M2-A, M2-B, and M2-C are graduated and integrated.
- The original Coding Task, correction, handoff, final Candidate, verifier, Review Graph failures,
  and stop packet remain immutable durable evidence.
- The exact private Revision patch must match the frozen digest and pass `git apply -p2 --check`
  against current source before submission. Any product-path drift stops this Work Item.
- The non-Coding journey remains blocked until this Candidate is reviewed, accepted, integrated,
  activated, and passes the three existing serial integrated-source audits.

## Inputs and outputs

Inputs:

- the parent Coding spec and `evidence/m2-coding-journey-stop-decision-packet.md`;
- the read-only seed
  `goals/forklight-main-led-execution/execution/m2-coding-review-recovery/ebd14c70-400f-4f99-aab6-adc938e54938.patch`;
- the frozen Revision id, full digest, four affected paths, verifier commands, and current source.

Outputs:

- one ForkLight Candidate whose patch bytes and digest exactly equal the frozen final Revision;
- fresh independent verifier evidence for the three approved commands;
- exactly one fresh two-Judge Review Graph on that exact Candidate and Main's bound decision;
- after accept only: safe ForkLight Integration, activation, and the three existing serial audits.

## Writable paths and orthogonality

The Worker may change only these four paths by applying the seed exactly once:

- `src/core/integration.ts`
- `src/daemon/coordinator.ts`
- `tests/integration-operation.test.ts`
- `tests/integration.test.ts`

The seed is read-only Task input and must not appear as a changed Candidate path. No other product
Writer runs concurrently. The later non-Coding Work Item has disjoint writable paths but a real
semantic dependency on activated recovery truth, so Main keeps the wave serial and integrates one
Candidate at a time.

## Forbidden paths and non-goals

- No behavior correction, refactor, new test scenario, Store/API/schema change, build/activation
  recovery, replay, CLI/MCP shape, Runtime/Profile/routing change, Hub/UI, commit, push, remote, or
  credential access.
- No second-hop handoff, Store rewrite, manual source patch, Candidate filtering, lock, lease,
  content-addressed manifest, distributed coordination, multi-user consistency, or repeated review.
- The Worker never mutates source project, ForkLight Home, backup, Integration, or another repo.

## Acceptance and review

- Seed bytes equal the frozen full digest and apply cleanly once to the clean Task baseline with
  `git apply -p2`; resumed execution detects an already-applied seed and never applies twice.
- The resulting ForkLight Candidate contains exactly the four accepted paths and its full patch
  digest equals `a862bfe4...054f651`; there is no generated, seed, Goal, Hub, or unrelated diff.
- ForkLight independently passes build, the 276-test focused surface, and diff validation.
- One fresh Review Graph uses two independent read-only Judges. Both must return usable exact-
  Revision opinions. Main inspects provenance, full diff, error paths, tests, compatibility, and
  both opinions; Judges do not edit or authorize Integration.
- If either Judge is unusable or reports a real blocker, if digest/source compatibility differs,
  or if any behavior change is proposed, stop without correction, replacement Task, extra Judge,
  model switch, or Integration and return a decision packet.

## Verification commands

```text
test "$(shasum -a 256 goals/forklight-main-led-execution/execution/m2-coding-review-recovery/ebd14c70-400f-4f99-aab6-adc938e54938.patch | awk '{print $1}')" = "a862bfe4abcec99ae32e364ae7df12eb85a30e15d3d65bce67965cbfe054f651"
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/integration.test.ts tests/integration-operation.test.ts tests/daemon.test.ts
git diff --check
```

The local verifier keeps the existing 30-minute per-command safety breaker. The Work Item has no
absolute duration, Token, or no-progress deadline and no correction/review loop.

## Handoff and workspace disposition

Handoff names the original/final Task lineage, exact seed Revision and digest, new Task/Session,
new Candidate Revision and digest, verification, both Judge outcomes, Main decision, Integration
operation, audits, and any exact stop reason. It does not copy credentials, raw Home data, source
bytes, or private command output into project evidence.

Protect original and recovery Workspaces, Candidate artifacts, verification, reviews, and logs
until terminal Main disposition. The source-tree seed remains only as bounded operational Goal
input through verification and Integration source checks. After accepted Integration and audits,
remove that exact temporary seed and use ForkLight storage preview/reclaim for ordinary eligible
regenerable space while retaining durable evidence. If recovery stops, keep the Workspace protected.

### Post-Integration audit admission supplement

The exact Candidate later passed review and safe Integration, but the first Codex native-goal audit
proved an admission mismatch: `allowEdits:false` prevented direct generated writes and that Runtime
does not expose checkpoint MCP. Product source stayed unchanged. The accepted bounded supplement is
`coding-integrated-audit-recovery/spec.md`; it reuses the integrated Candidate and replaces only the
zero-change audit evidence with serial checkpoint-capable Runtime Tasks. It does not reopen this
implementation, add a review round, or weaken a command.
