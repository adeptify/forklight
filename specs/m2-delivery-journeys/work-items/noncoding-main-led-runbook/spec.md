# M2 non-Coding journey — Main-led local delivery runbook

## User result

A local developer can follow one concise runbook from health/readiness through Goal submission,
intentional daemon restart recovery, independent verification, Judge review, evidence-based
correction or handoff, Main decision, safe Integration, and terminal workspace disposition without
reading the Store, guessing hidden state, or stitching together scattered command sections.

## Background and `depends_on`

`docs/operations.md` accurately documents individual surfaces, but no operator-facing journey joins
them in the order Main actually uses them. The runbook is useful product documentation, not a
ceremonial report or the M2 evidence file.

This Work Item depends on accepted, activated Integration and integrated-source audit of
`coding-source-only-integration-recovery`. Although documentation paths do not overlap code paths,
the behavior is a semantic input, so this Work Item starts only afterward.

## Inputs and outputs

Inputs:

- current integrated CLI/API behavior and `docs/operations.md`;
- the accepted M2 execution, review, Integration, recovery, and storage contracts;
- privacy-safe command and status examples using placeholders rather than real Task/Home data.

Outputs:

- `docs/main-led-delivery.md`: one short, staged local runbook with decision points and recovery
  boundaries;
- one discoverable link from `README.md` and a short cross-reference from `docs/operations.md`.

## Allowed and forbidden paths

Allowed writable paths:

- `docs/main-led-delivery.md`
- `docs/operations.md`
- `README.md`

Forbidden:

- any source, test, config, Goal/Spec/evidence, generated output, Hub/UI, other repository,
  credential, commit, or push;
- claims of Grok/native Goal availability that current health cannot prove;
- hidden Store/SQLite instructions, manual Workspace deletion, direct process archaeology, manual
  patch application, automatic retries/Competition, or unsupported Integration recovery;
- multi-user, distributed, lock/lease/checksum/version-handshake guidance.

## Required content and call flow

The runbook must use plain language and show one primary path:

1. Check exact-build health and Worker readiness; explain honest `persistent-session`, `single-run`,
   and `native-goal` labels only where actually supported.
2. Submit an accepted Goal/Plan/Task and observe durable IDs.
3. Restart the daemon intentionally while a Worker is active, then re-query the same Task and show
   the one linked continuation rather than resubmitting.
4. Read Worker self-check and ForkLight verification; create the frozen number of independent
   Judges; do not let Judge votes replace Main judgment.
5. Accept, revise/correct, or retain/handoff only the evidenced gap. State the two-no-new-evidence
   stop rule and reuse accepted paths.
6. Run safe Integration preflight/apply/wait on the exact Candidate. Distinguish a disconnected
   observer from daemon-process crash; describe the newly delivered source-only recovery boundary
   and the remaining unsupported build/activation crash window exactly.
7. Audit/preview and confirm ordinary terminal workspace reclaim only after delivery evidence is
   durable; preserve unknown, active, under-review, or reusable-partial content.

Commands must match current CLI help and use symbolic placeholders such as `<task-id>`. The runbook
must link to detailed operations sections instead of duplicating every option.

## Scenarios and acceptance

- A first-time local operator can identify what Main decides, what Worker executes, and which IDs to
  retain across restart/reconnect.
- The primary path contains no Store query, manual deletion, raw home path, credential step, commit,
  push, or Hub dependency.
- Restart continuation never instructs the user to recreate a still-running Task. Timeout and
  disconnect never imply failure or authorize replay.
- Judge counts, correction/handoff, Integration recovery limits, and workspace protection match
  integrated behavior and the accepted Goal contract.
- README and operations links resolve; no duplicate roadmap/status system is introduced.
- The Candidate is documentation-only and concise enough to run as an operational checklist.

## Verification commands

```text
npm run build
node dist/src/cli.js --help
git diff --check
```

ForkLight independently runs the commands. The Work Item has no absolute duration, Token ceiling,
or no-progress timeout.

## Interruption proof, review, handoff, and workspace disposition

- Worker owns documentation research, drafting, command comparison, self-check, and correction.
- After one coherent useful runbook section or link structure exists, Main performs one confirmed
  daemon restart. ForkLight must continue the same Task/Session lineage; Main does not recreate or
  rewrite the Candidate.
- One independent read-only Judge reviews accuracy, usability, unsupported claims, and scope. Main
  reviews the exact Candidate and integrates serially through ForkLight.
- Handoff includes Task/Session/Attempt lineage, Candidate revision, documentation diff, verifier,
  Judge, and unresolved inaccuracies. Protect the Workspace through review/Integration; reclaim
  ordinary regenerable space afterward while preserving durable evidence.

Stop rather than expand into UI, general documentation rewrite, generated tutorials, another
roadmap, or unsupported product promises. Two purposeful rounds with the same gap or no new evidence
return a decision packet.

