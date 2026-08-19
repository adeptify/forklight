# M4-C Work Item — Acceptance-contract-only replacement

## User result

Deliver the already verified M4-C family value report by reusing the exact final recovery Candidate
and correcting only the contradictory acceptance phase. Do not ask Grok to rewrite product or test
code.

## Background and evidence

Recovery Task `812df915-788c-463c-8ee0-208d71ff9d58` produced Revision
`debbf06b-a10f-4206-8382-60c1ea450ed4`, digest
`d7327f8c6a0ccd5232b950af4a2ed59143f2c0ef81c846d5287c6305352d92ab`, across the exact ten M4-C
paths. Its only difference from retained Revision `61dc45c0-e4b2-49c3-95db-f54a3a4d7861` is the
authorized behavior-based CLI test. Independent build, 343/343 focused tests and diff validation
passed.

That Task failed only because a clean-source bootstrap policy check was also listed as a
post-Candidate acceptance command. After the wrapper had already applied the seed, that command
necessarily tried to apply it a second time. ForkLight event `3165` attributes this to
`acceptance-contract / non-model`. The unchanged reverify was intentionally not consumed.

一骏 explicitly revoked the prior no-replacement boundary and authorized exactly one
acceptance-contract-only replacement.

## `depends_on`

- M4-A and M4-B remain integrated and activated.
- The parent `specs/m4-c-family-value-report/spec.md` remains authoritative for product behavior.
- Both earlier M4-C Tasks, their Attempts, Goals, Revisions and Workspaces remain immutable and
  protected.
- `goals/forklight-main-led-execution/evidence/m4-c-final-recovery-stop-decision-packet.md` is the
  accepted failure evidence.

## Inputs and outputs

Inputs:

- Workspace-local retained product seed
  `goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-retained-candidate.patch`, packaged
  digest `92c1e363639903d243cc3a1939d50d69ee2f7198e50b0d741286a07c6d836312`;
- Workspace-local final test delta
  `goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-final-test-delta.patch`, digest
  `1c997a355684d4b17b96d9753abe72ceca9b15080434889097e24c60f724d6e8`;
- the current M4-B source base and the exact ten-path contract.

Outputs:

- one fresh Candidate byte-equivalent to Revision `debbf06b-a10f-4206-8382-60c1ea450ed4` in all ten
  paths;
- passing post-application seed proof, build, 343-test suite and diff validation;
- two fresh different-view Judge results and Main serial safe Integration evidence.

## Allowed and forbidden paths

The Candidate may contain exactly these ten paths, materialized by the Main-owned wrapper:

- `src/cli.ts`
- `src/core/main-token-value-report.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/mcp/server.ts`
- `tests/daemon-cli.test.ts`
- `tests/daemon.test.ts`
- `tests/main-token-value-report.test.ts`
- `tests/mcp.test.ts`

The Grok Worker is read-only and may edit no path. Goal-local plan mutations are allowed by the
native Runtime, but Workspace Write/Edit and terminal commands remain denied. Goal/Spec/evidence,
seed, wrapper and source-project files are Main-owned and forbidden to the Worker.

## Implementation and call chain

1. ForkLight snapshots both Workspace-local patches and the wrapper into one clean Task Workspace.
2. The wrapper validates the two exact digests/path sets against the matching source base, applies
   the retained seed followed by the single-file test delta, records a Task-local marker, and
   launches Grok 4.6 Xhigh current-model-only native `/goal`.
3. Grok reads the accepted contract and final Candidate, makes no Workspace edit, and completes
   the native Goal with an evidence-based handoff.
4. ForkLight independently verifies the post-application state: the final delta reverse-checks,
   the other nine retained paths reverse-check, and the Candidate diff contains exactly ten paths.
5. ForkLight runs build, the complete 343-test suite and diff validation. Two fresh Judges inspect
   the exact Revision; Main alone may accept and integrate it.

## Acceptance

1. Clean-source preflight proves the base seed forward-applies current source, reverses the old
   retained Workspace, the test delta forward-applies that retained Workspace and reverses the
   final recovery Workspace.
2. Runtime bootstrap reads only Task-Workspace-local seeds, enforces their exact digests/path sets,
   uses isolated Git config and launches current-model-only Grok native Goal.
3. Post-application verification proves exactly ten Candidate paths, reversibility of the final
   test delta, and reversibility of the other nine retained paths. It never attempts a second
   forward application.
4. Final Candidate is byte-equivalent to the already verified final recovery Candidate; Grok makes
   no product/test edit.
5. Build, all 343 focused tests and `git diff --check` pass. Parent M4-C claim gating, missing
   evidence, economics separation, privacy, Daemon/CLI/MCP agreement and read-only behavior remain
   unchanged.
6. One fresh Grok 4.6 Xhigh native Goal, ForkLight independent verification, two fresh
   different-view Judges, Main exact-Revision decision and serial safe Integration complete the
   quality chain.

## Verification commands

Pre-submission Main proof only:

```text
node goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-acceptance-replacement-policy.test.mjs
```

ForkLight independent post-Candidate acceptance:

```text
node goals/forklight-main-led-execution/execution/m4-wave-1/m4-c-acceptance-replacement-postapply.test.mjs
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/main-token-usage.test.ts tests/main-token-pair.test.ts tests/main-token-value-report.test.ts tests/task-economics-report.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

## Stop rule

- One base Attempt only. No generic extra Attempt, Worker validation repair, Main correction,
  adaptation, no-Worker reverify, model switch, fallback or further replacement.
- Stop immediately if either seed/source check fails, Grok changes any Workspace byte, native Goal
  truth is not terminal achieved, independent acceptance fails, or the boundary must widen.
- No Hub/UI, automatic calibration, ranking, Competition, checksum system, lock, lease, version
  handshake, commit, push or reset.

## Handoff and Workspace disposition

Worker hands off the materialized exact Candidate and explicitly reports zero Workspace edits.
ForkLight preserves all three M4-C Workspaces through dual review and activated Integration. Main
integrates only the exact independently verified Revision. After terminal resolution, reclaim only
regenerable Task space through ForkLight's audited storage lifecycle; retain Revision,
verification, Judge, Main and Integration evidence.
