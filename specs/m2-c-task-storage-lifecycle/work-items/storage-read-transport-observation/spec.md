# M2-C storage read transport observation window

## User result

`forklight storage audit` and an exact `forklight storage preview --task <id>` can return current
local Store and filesystem truth even when a large real Home takes longer than the generic
15-second daemon request window. Ending one client observation never cancels, retries, replays or
changes the underlying read-only scan.

## Background and current evidence

The accepted parent is `specs/m2-c-task-storage-lifecycle/spec.md`. Storage lifecycle, the earlier
long `storage_reclaim` observation fix, resolved-terminal precedence, required review/Integration
and three activated-source audits are already delivered. 一骏 then explicitly authorized reclaim
of six exact historical Tasks, but Main's first fresh serial preflight command
`forklight storage preview --task f5d1142a-6eca-4d4c-8c43-801d0b284056 --json` returned
`ForkLight daemon request timed out: storage_preview` before any deletion began.

The Daemon finished the read-only work after the client disconnected. A follow-up no-timeout read
of the same Daemon method returned the expected `reclaimable/main-resolved-terminal` result with
unknown 0, process 0 and integrity `ok/0`; a warm measured scan still took 12,631 ms, leaving little
margin under the fixed 15-second transport deadline. Current source intentionally keeps
`storage_audit` and `storage_preview` at 15 seconds while `storage_reclaim`, remediation and
Candidate reverification use the established long observation mapping. The real Home now has 427
known Task roots, so the earlier short-method assumption is no longer reliable.

This is an observation gap, not a storage classification or deletion failure. Main will not use an
old preview or bypass the CLI to authorize destructive work.

## `depends_on`

- M2-C storage lifecycle and reclaim transport observation are integrated and activated.
- Resolved-terminal Candidate and read-only native Goal plan persistence are integrated; all three
  current activated-source audits passed with zero diffs.
- User authorization is frozen to six exact Task ids, but reclaim stays paused until the activated
  CLI can return fresh previews normally.
- No concurrent product writer, Integration or reclaim operation may overlap this Work Item.

## Inputs and outputs

Inputs:

- the daemon method and params passed to `daemonRequestTimeoutMs`;
- the existing long observation mapping and response slack;
- current `storage_audit`, `storage_preview`, `storage_reclaim`, `storage_retain`, health and
  verification timeout tests.

Outputs:

- `storage_audit` and `storage_preview` share the established long daemon observation mapping;
- optional internal `requestTimeoutMs` continues to receive existing response slack and minimum;
- `storage_retain`, health and other ordinary short methods remain at 15 seconds;
- no retry, replay, cancellation, new operation record, public setting or storage-state change.

## Allowed paths and serial ownership

One Grok 4.6 Xhigh native Goal Writer owns both tightly coupled paths:

- `src/daemon/client.ts`
- `tests/daemon.test.ts`

No other product or test path is writable. Main alone updates this Spec, Goal SSOT/evidence,
reviews, integrates, activates and later executes the already authorized exact reclaim.

## Required behavior and call chain

1. CLI or MCP requests storage audit or exact preview through the existing `daemonRequest` path.
2. The exact-build health handshake remains unchanged.
3. `daemonRequestTimeoutMs` treats the two potentially long filesystem scans as long observations,
   alongside existing long verification/reclaim methods.
4. The Daemon computes current Store/filesystem truth once and returns it; client observation never
   changes server authority or starts a second scan automatically.
5. Existing CLI/MCP rendering receives the same response shape. Real transport or server errors
   remain errors.

## Acceptance

- Default `storage_audit` and `storage_preview` timeouts equal the established long observation
  window plus response slack, not 15 seconds.
- A valid internal 30-second request override maps to 35 seconds; a value of 1 cannot reduce below
  the existing 15-second safe minimum.
- `storage_reclaim`, remediation, Candidate reverification, Integration/checkpoint waits keep their
  current semantics.
- `storage_retain` and health remain generic short methods.
- Candidate changes only the two allowed paths and ForkLight independently passes all commands.
- Two independent read-only Judges inspect no-replay/cancellation semantics and short-method
  containment. Main accepts only the exact Revision and uses normal serial Integration.
- After activation, real CLI audit and all six exact previews return normally before any reclaim.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

The verifier keeps ForkLight's 30-minute per-command safety breaker. The Work Item has no Task
duration, Token or no-progress ceiling. A transport observation window is never Goal completion or
failure evidence.

## Forbidden and stop rules

- No storage classifier, deletion, disposition, Store, daemon server/coordinator, protocol, CLI/MCP
  schema, public setting, Runtime, Hub/UI or unrelated test change.
- No real Home mutation in the Worker or verifier; the authorized reclaim remains Main-only and
  begins only after activation plus fresh previews.
- No retry/replay/cancel path, asynchronous operation, new state machine, lock, lease, checksum,
  handshake, migration, multi-user/distributed mechanism, commit, push or reset.
- Stop if the fix needs more than the shared timeout resolver and focused test, if any short method
  widens unintentionally, or if two purposeful rounds repeat the same failure without new evidence.

## Handoff and workspace disposition

The Worker reports the exact method mapping, preserved short/long methods, focused test evidence and
remaining risk. ForkLight independently verifies; two Judges bind to one Revision; Main reviews the
actual diff and integrates serially. Protect implementation/Judge Workspaces until Integration and
live CLI proof are durable. Do not reclaim them as part of this Work Item.

## Completion evidence

- Implementation Task `14992906-f3ac-4ff6-8555-e3859792ae88`, Session
  `81db95f9-8856-45f5-88c2-dc7bed5d65a3`, Attempt
  `a400dbdf-b249-4d86-8502-8c77b843d293` completed native Goal
  `6f29c8b8-f47f-4b4d-9f35-1ebc3d73be1c` as `complete/Idle + achieved` with a 5,126-byte plan.
- Exact Revision `20662dd6-0206-434c-9e90-4797996482e1`, digest
  `6354907cf0a3003bcb11cc5bb4b2a5a06158ca1519eb929661fb76db432d0134`, changed only the two
  allowed files (23 changed lines). Verification sequence `1882` passed every accepted command.
- Review Graph `a9e592b3-77cd-43eb-b38d-145b1869aa2b` received usable accepts from Codex Luna Max
  and DeepSeek Flash. Main accepted the exact Revision; Integration
  `8e97d3f9-0c83-43f5-b18d-5ae083ed23e0` passed apply, verification, build and activation.
- Source `npm run check` passed 2,971/2,971. Restarted client and Daemon build identities matched.
- Activated `storage audit` and all six exact serial `storage preview` commands returned without the
  former 15-second observation failure. The authorized exact reclaim and post-reclaim audit then
  passed; detailed destructive evidence is in
  `goals/forklight-main-led-execution/evidence/m2-storage-read-transport-and-final-reclaim.md`.

All acceptance items passed. No retry/replay/cancel path, public setting, storage semantic change,
short-method widening, commit, push or reset was added.
