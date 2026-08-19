# M4-C Work Item — Exact-Candidate test-only recovery

## User result

Deliver the already implemented M4-C family value report without rebuilding accepted behavior,
changing product semantics or carrying forward one brittle source-text test.

## Background and evidence

Task `89e60adc-d9ca-4560-9940-b423698c51f0` produced exact Revision
`61dc45c0-e4b2-49c3-95db-f54a3a4d7861`, digest
`6f7d174e5c1efdb4d859902e3a25edcd51f16933cba5a77d5e637a211a8a5687`, across the ten accepted
M4-C paths and 1,891 changed lines. A no-Worker runtime-Workspace reverification passed build and
`git diff --check`; 342/343 focused tests passed. The one failure is
`value-report CLI reads flags from the full remainder after the command`, which truncates a source
substring before `switches.has("--json")`. The real CLI empty/seeded JSON and human behavior test
passes in the same run.

The old native Goal paused after two non-achieving classifier rounds. A structured Main correction
then failed before model work because a `no_progress_paused` Goal cannot be continued as a normal
successor. The old Task has exhausted validation repair, reverify and correction authority. Its
Workspace and exact Candidate remain protected.

## `depends_on`

- M4-A and M4-B remain integrated and activated.
- The parent M4-C spec remains authoritative for all product behavior.
- The retained Revision, its protected Workspace and verification sequence `7034` are immutable.
- Main has recorded `evidence/m4-c-initial-task-stop-decision-packet.md`.

## Inputs and outputs

Inputs:

- Workspace-local seed `goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-retained-candidate.patch`;
- exact retained Candidate digest and ten-path set; the repository-packaged patch has digest
  `92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312` because the text artifact
  carries the repository's final newline, while forward/reverse apply proves identical product/test
  output;
- current source base and the old protected Workspace for forward/reverse preflight only;
- one remaining test gap.

Outputs:

- one fresh Candidate containing the exact retained ten-path behavior plus only a focused test
  correction in `tests/main-token-value-report.test.ts`;
- passing unchanged M4-C acceptance commands;
- exact Revision and independent evidence for two fresh different-view Judges and Main review.

## Allowed paths

The final Candidate may contain only the retained ten paths:

- `src/core/main-token-value-report.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/cli.ts`
- `src/mcp/server.ts`
- `tests/main-token-value-report.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`

The fresh Worker may edit only `tests/main-token-value-report.test.ts`. All other Candidate paths
must remain byte-equivalent to the retained seed.

## Implementation and call chain

1. ForkLight snapshots the Workspace-local seed and recovery wrapper into a clean Task Workspace.
2. The wrapper checks the one authorized seed digest/path set and current source applicability,
   applies it once, then starts a fresh Grok 4.6 Xhigh native `/goal`.
3. Grok removes or replaces only the brittle source-text regex test with behavior-based coverage;
   it does not change product code or other tests.
4. ForkLight independently runs the wrapper policy test and unchanged parent acceptance commands.
5. Two fresh independent Judges inspect the exact Candidate; Main alone accepts and integrates.

## Acceptance

1. The seed has the exact retained digest/path set, forward-applies current source and
   reverse-applies the old protected Workspace. This is the single check preventing wrong
   Candidate/source-base reuse; no other hash, lock, lease or version mechanism exists.
2. Final diff contains exactly the ten retained Candidate paths; only
   `tests/main-token-value-report.test.ts` differs from the retained seed.
3. The brittle source-text regex is removed or replaced by a behavior assertion. Real CLI JSON and
   human tests remain authoritative and pass.
4. All parent M4-C report, economics-separation, privacy, read-only and public-surface acceptance
   remains unchanged and passes.
5. One fresh Grok 4.6 Xhigh native Goal is used honestly. It has one base Attempt, zero generic
   extra Attempt, zero validation repair/correction/adaptation and at most one no-Worker reverify
   if native terminal truth stops after useful edits.
6. Two fresh different-view Judges and Main serial safe Integration remain mandatory.

## Verification commands

```text
node goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-workspace-local-recovery-bootstrap.test.mjs
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/main-token-usage.test.ts tests/main-token-pair.test.ts tests/main-token-value-report.test.ts tests/task-economics-report.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

## Forbidden and stop rule

- No product behavior change, Store/schema change, new report reason/field, hidden pair selection,
  automatic calibration, model switch, Competition, Hub/UI, commit, push or reset.
- No second recovery Task, extra Worker Attempt, validation repair, Main correction, adaptation or
  fallback. If the one fresh Task plus optional no-Worker reverify does not pass, stop M4-C with a
  final decision packet.

## Handoff and Workspace disposition

Worker hands off the exact test delta and confirms all other retained bytes are unchanged.
ForkLight preserves both old and recovery Workspaces through review and activated Integration.
After terminal disposition, reclaim only regenerable recovery space through the audited product
path; retain Candidate, verification, Judge, Main and Integration evidence.
