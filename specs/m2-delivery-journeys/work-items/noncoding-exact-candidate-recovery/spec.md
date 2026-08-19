# M2 non-Coding journey — exact three-path Candidate recovery

## User result

The already verified, wording-correct documentation Candidate is materialized unchanged in one
correctly admitted ForkLight Task, independently re-verified, reviewed by one fresh Judge, and—only
after Main accepts that exact Revision—safely integrated. The existing three post-Integration
non-Coding audits then complete without replaying the original writing, correction, restart, or
handoff journey.

## Background and authority

The accepted behavior and documentation contract remains
`specs/m2-delivery-journeys/work-items/noncoding-main-led-runbook/spec.md`. Original Grok Task
`fd41a1dc-ca0e-4918-8002-f9932908c35d` proved same-Task/Session restart continuation and produced a
concise verified Candidate. One-hop successor `91d34265-fdca-4623-8aa1-646c90ff1e36` corrected the
only remaining `unknown-orphan` wording gap and independently passed all four commands. Its
Candidate Revision is `04e736e7-b595-44a4-96b1-b82d2dd6cb5b`, with full patch digest
`65deb60f3f4c6f5fe3730076e07a29cca52a0fb76019c18daf6a7d817554373a`, three paths, and 148 changed
lines. Main stopped only because the successor Task's immutable execution mode was contradictory.

一骏 authorized exact Candidate recovery after the handoff destination-execution fix. The digest
check exists solely to prevent materializing or integrating the wrong Candidate or source base. It
is not a general checksum protocol, content-addressed manifest, lock, lease, or version handshake.

## `depends_on`

- `handoff-destination-execution-truth` must pass independent verification, two usable Judges,
  Main accept, safe Integration, activation, full source check, and its three serial zero-change
  audits.
- The original non-Coding Task, restart lineage, correction, Judge, handoff, successor, Candidate,
  verifier, and Main revise remain immutable evidence. No second-hop handoff is used.
- The exact private Revision patch must still match the frozen full digest and pass
  `git apply -p2 --check` against the post-fix current source. Any documentation source drift stops
  this Work Item.
- M3 remains closed until this recovery, the three original non-Coding audits, final M2 evidence,
  full check, and storage audit finish and 一骏 confirms the Milestone boundary.

## Inputs and outputs

Inputs:

- the parent runbook spec and non-Coding stop decision packet;
- a bounded read-only seed copied from the exact private Revision into
  `goals/forklight-main-led-execution/execution/m2-noncoding-candidate-recovery/04e736e7-b595-44a4-96b1-b82d2dd6cb5b.patch`;
- the frozen Revision id, full digest, three affected paths, four acceptance commands, current
  post-fix source, and original three audit contracts.

Outputs:

- one ForkLight Candidate whose patch bytes, full digest, affected paths, file count, and changed-
  line count exactly equal the stopped successor Revision;
- a correctly admitted Task whose saved Worker/Profile/Runtime execution truth is internally
  consistent;
- fresh independent verification and exactly one usable read-only Judge opinion bound to that
  Revision;
- after Main accept only: safe ForkLight Integration, activation, and the three existing serial
  zero-change audits.

## Writable paths and orthogonality

The recovery Worker may change only these three paths by applying the seed exactly once:

- `README.md`
- `docs/main-led-delivery.md`
- `docs/operations.md`

The seed is read-only Task input and must never appear as a Candidate path. No product Writer runs
concurrently. Although these paths do not overlap the preceding code fix, this recovery consumes
its activated truth and audits, so Main keeps both Work Items strictly serial and integrates one
Candidate at a time.

## Forbidden paths and non-goals

- No documentation rewrite, wording improvement, behavior correction, new example, product code,
  test, config, Goal/Spec/evidence, generated output, Runtime/Profile, review, storage, Hub/UI, or
  other repository change.
- No second-hop handoff, Store rewrite, manual source patch, Candidate filtering, retry, correction,
  extra Judge, model switch, Competition, commit, push, remote, or credential access.
- No lock, lease, general checksum/content-addressing, manifest, version handshake, migration,
  duplicate consistency proof, multi-user, or distributed coordination.

## Acceptance and review

- Seed bytes equal full digest
  `65deb60f3f4c6f5fe3730076e07a29cca52a0fb76019c18daf6a7d817554373a` and apply cleanly once to
  the clean current Task baseline with `git apply -p2`. A resumed materializer detects already-
  applied content and never applies twice.
- The resulting Candidate has exactly `README.md`, `docs/main-led-delivery.md`, and
  `docs/operations.md`; it contains 145 insertions, 3 deletions, 148 changed lines, and the same
  full patch digest. There is no seed, generated, product, test, Goal, Spec, evidence, or unrelated
  diff.
- The saved Task execution preference/mode matches its admitted Worker Profile and Runtime; no
  historical Task is relabeled.
- ForkLight independently passes the original four commands. One fresh independent read-only Judge
  returns a usable exact-Revision opinion on accuracy, usability, unsupported claims, and scope.
  Main independently inspects provenance, exact bytes, full diff, commands, and opinion.
- If any byte/digest/path/source check differs, any command fails, the Judge is unusable or reports
  a blocker, or a behavior/content change is proposed, stop without correction, replacement Task,
  extra Judge, model switch, Integration, or manual apply.

## Verification commands

```text
test "$(shasum -a 256 goals/forklight-main-led-execution/execution/m2-noncoding-candidate-recovery/04e736e7-b595-44a4-96b1-b82d2dd6cb5b.patch | awk '{print $1}')" = "65deb60f3f4c6f5fe3730076e07a29cca52a0fb76019c18daf6a7d817554373a"
npm run build
node dist/src/cli.js --help
node -e "const fs=require('node:fs'); const readme=fs.readFileSync('README.md','utf8'); const operations=fs.readFileSync('docs/operations.md','utf8'); if(!fs.existsSync('docs/main-led-delivery.md') || !readme.includes('docs/main-led-delivery.md') || !operations.includes('main-led-delivery')) process.exit(1)"
git diff --check
```

The local verifier keeps the existing 30-minute per-command safety breaker. The recovery has no
absolute duration, Token, or no-progress deadline, zero correction rounds, and one review round.

## Handoff and workspace disposition

Handoff names the original and successor lineage, exact source Revision/digest, bounded seed,
recovery Task/Session, truthful execution mode, new exact Candidate, verifier, Judge, Main decision,
Integration operation, three audits, and any precise stop reason. It excludes credentials, raw
Home data, source bytes, and private logs.

Protect the original, successor, and recovery Workspaces and all Candidate/review evidence until
terminal Main disposition. After accepted Integration and audits, remove only the exact temporary
source-tree seed, then use ForkLight storage audit/preview/reclaim for ordinary eligible
regenerable recovery space while retaining durable evidence. If recovery stops, keep its Workspace
protected. The earlier original/successor Workspace disposition remains outside this Work Item.
