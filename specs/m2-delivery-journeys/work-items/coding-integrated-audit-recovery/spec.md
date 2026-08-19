# M2 Coding journey — integrated audit admission recovery

## User result

The safely integrated exact Coding Candidate receives the required zero-change integrated-source
audits through Runtime contracts that can actually hand write-requiring acceptance commands to
ForkLight's independent checkpoint/verifier, without reopening implementation or weakening any
machine gate.

## Background and `depends_on`

Candidate Revision `57b295fc-3c08-4445-a8a5-d615dc6431bd` is byte-identical to frozen Revision
`ebd14c70-...` (full digest `a862bfe4...054f651`), passed independent verification and two usable
Judges, received Main accept, and was safely integrated by operation
`15bd69bc-d5cf-4668-a75a-ab0aa74f2057`. Source apply/verify, artifact build, activation, and health
all passed.

The first downstream audit Task `15458a3c-...` failed before ForkLight verification because its
Codex native-goal Runtime had `allowEdits:false`, lacks checkpoint MCP, and therefore could neither
create verifier-generated `dist/`/tsx cache nor run `git diff --check` in a snapshot without Git
metadata. Source remained unchanged and the failure is Runtime/admission evidence, not product or
test failure. The original audit Task and Goal remain immutable.

This supplement depends on the completed Integration above and current matched Daemon/client build
identity. It is allowed only because all replacement Tasks are read-only, zero-change, deterministic
and use currently smoke-verified Claude-Code Providers that support ForkLight checkpoint MCP.

## Inputs, outputs, and paths

Inputs are the accepted Coding spec, exact integrated source, Integration result, focused tests,
and the failed audit timeline. Outputs are four serial zero-diff verdicts covering integrated call
chain, activated Runtime identity/boundary, wrong-Candidate and rollback refusal, and existing
operation-surface compatibility.

Workers may inspect only:

- `src/core/integration.ts`
- `src/core/integration-operation.ts`
- `src/core/types.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/client.ts`
- `tests/integration.test.ts`
- `tests/integration-operation.test.ts`
- `tests/daemon.test.ts`

No Worker may edit any file. The four gates run serially because they share the same activated truth
and machine surface; Main does not manufacture parallelism or run another product Writer.

## Forbidden and non-goals

No product correction, re-Integration, source mutation, new test, docs, schema/API/protocol change,
Runtime/Profile product change, Hub/UI, real-home mutation, commit, push, credential access, extra
Judge, lock, lease, checksum, manifest, version handshake, or distributed coordination. This does
not label Codex native-goal unsupported generally; it records only the concrete read-only checkpoint
mismatch in the failed audit admission.

## Acceptance and verification

- Every Worker returns a bounded read-only verdict and zero business/generated/Integration diff.
- Workers invoke the approved acceptance surface through ForkLight checkpoint MCP; independent
  verification remains authoritative.
- Integrated call chain passes build, 276 focused tests, and diff validation.
- Activated boundary reports matched client/Daemon identity and keeps build/activation replay out of
  source-only recovery.
- Wrong Candidate, unreadable/corrupt backup, path symlink, mismatched receipt/stages, and build or
  activation declarations fail closed without source mutation.
- Status/wait/history, Goal reconciliation, legacy reads, observer disconnect, activation handoff,
  privacy, and original operation IDs remain compatible.

Approved command union:

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/integration.test.ts tests/integration-operation.test.ts tests/daemon.test.ts
node dist/src/cli.js health --json
git diff --check
```

Local acceptance keeps the 30-minute per-command breaker; Task duration, Token, and no-progress
limits are null. There is no correction or review loop. Any product finding, nonzero diff, failed
independent command, or second Runtime/admission failure stops the supplement with a decision packet.

## Authorized final acceptance-contract resolution

一骏 explicitly authorized the recommended decision-packet resolution on 2026-08-14. The stopped
Goal and both admission failures remain immutable evidence. Main may now perform exactly one final
acceptance-contract-only resolution with these bounds:

1. Record the failed Task `f17333fc-8ec8-45a1-b082-082b92ba7d0d` as
   `acceptance-contract`, then bind one Main `revise` to Attempt
   `e5977c17-ee10-4672-95b6-f23fe5dae412` and verification event 108.
2. Use ForkLight's existing `remediate verify --amendment` path. Preserve the three passing command
   slots byte-for-byte and replace only the failed Workspace-local health assertion with a bounded
   assertion that isolated health truthfully reports `daemon-unavailable` and still exposes a
   built client identity. The activated identity claim remains separately bound to safe Integration
   `15bd69bc-d5cf-4668-a75a-ab0aa74f2057` plus Main's real-source `identityStatus: matched` check.
3. The admitted milestone is a `machine` gate, and ForkLight deliberately does not relabel a failed
   Task as machine success from Main remediation. Therefore the remediation is durable reuse
   evidence, not permission to rewrite the existing Goal. ForkLight Goals require 4–8 milestones,
   so the final operational Goal at `execution/m2-coding-final-audits/goal.json` runs one necessary
   acceptance-contract-boundary gate followed by the three remaining zero-change gates: corrected
   activated-boundary proof, wrong-Candidate/rollback safety, and operation-surface compatibility.
   The first gate proves exactly that amended remediation preserves the old failure and cannot
   unlock a `machine` gate; it is not another integrated-call-chain audit or a test-count task.
4. Final audit Tasks reuse the four previously accepted supplement Profiles, scopes and serial
   dependency; they use
   no Writer edits, Candidate, Judge, correction, Integration, model switch or new product behavior.
   The corrected activated-boundary Task runs build, the same focused tests and diff validation in
   its isolated Workspace. Main checks real-source health immediately before admission and after all
   three gates.
5. Another Runtime/admission failure, any nonzero diff, any failed independent command, or any
   product finding stops this final resolution. It may not create another Goal/Task, amend another
   command, retry, reroute or widen scope.

This authorization does not turn zero-change audit remediation into a general machine-gate bypass.
It uses the existing amended-acceptance record only to preserve the exact failed-slot correction,
then obtains fresh machine success from the smallest environment-correct Task contracts.

### Authorized attempt result and renewed stop

Main revise event 111 and `acceptance-contract/non-model` attribution event 114 are durable. The
single amended remediation check `eb46f89b-03a7-446e-be4f-90d87f922f8d` passed 3/4 commands and
created no delivery disposition. The replacement assumed the remediation verifier used the failed
Worker's isolated Home; product inspection proved remediation instead copies current source while
inheriting Main's real ForkLight Home. It therefore reached the matched real Daemon and failed the
replacement's `daemon-unavailable` assertion.

This is the further failed command named by item 5. The final Goal draft validated read-only but was
not submitted, and no final-audit Task exists in Store. The draft's first milestone now audits the
actual failed-remediation/no-delivery/machine-gate truth. Submission requires a new explicit
decision; a second amendment or remediation retry is not an accepted next action.

At the latest read-only preflight, all four retained supplement Profiles remain launchable but their
connection evidence is stale. After submission authorization and before Goal admission, Main must
run one current Provider smoke each for DeepSeek (shared by `default` and `deepseek-flash-1m`),
Volcengine, and MiniMax. Any failed smoke stops admission. It does not authorize changing a Profile,
using Grok for these frozen audits, recreating a Task, or probing repeatedly.

## Handoff and workspace disposition

Handoff names the failed original audit, replacement Goal/Task IDs, zero-diff/verification outcomes,
Provider/Runtime truth, and any blocker. Protect the failed and replacement audit Workspaces until
the final resolution reaches a terminal Main disposition. After all gates pass, stop superseded
waiting Goals, retain durable evidence, and reclaim only ordinary eligible regenerable space through
ForkLight storage preview/reclaim. Historical backup cleanup remains out of scope.
