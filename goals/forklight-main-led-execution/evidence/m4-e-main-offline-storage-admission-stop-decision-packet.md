# M4-E Main-offline storage admission stop decision packet

## Outcome

The accepted Main-offline storage-lifecycle comparison stopped before ForkLight Task admission.
The direct side remains valid and reusable, but the delegated side is incomplete: two measured
Codex Main sessions each called only the exact accepted `delivery prepare --task-file` command and
both failed before a Task was created. There is no delegated artifact, Task, Attempt, usage sample,
assessment, comparison or saving claim.

This is not a negative pair. It is an invalid/incomplete admission stop and does not admit Hub.

## Reusable direct evidence

- Pair root:
  `/var/folders/m2/tx2tqs290l913y61zqz413dr0000gn/T/forklight-m4e-main-offline-storage-pair-8zyolE`
- Direct run: `codex-run:01a0121e-f4b1-7a63-93f9-8dc1f19a8b9c`
- Model: `gpt-5.6-sol / xhigh`
- Terminal counters: 125,854 input, 106,240 cache read, zero cache creation, 2,448 output
- Canonical gross: 128,302
- Output: one 65-line artifact at the accepted path; closed validator and `git diff --check` pass
- No Store sample was recorded because the paired ForkLight Task does not exist

## Delegated admission evidence

After 一骏 restored Grok OAuth, matched health and a direct Grok 4.6 Xhigh smoke returned
`AUTH_OK`. The accepted task file still validated at quality 100, native Goal, no Worker duration/
Token/no-progress limit and two required Judges.

Measured segment zero:

- run `codex-run:01a01238-68b1-7313-8e88-cedd9d0687f7`
- exact command: one accepted `delivery prepare --task-file` with the frozen Task, Reviewers,
  reason and 30-second observation
- result: `ForkLight daemon process exited before becoming ready`
- counters: 46,071 input, 33,280 cache read, zero cache creation, 295 output
- gross: 46,366

The accepted Spec retained that cost and allowed one host Daemon restoration plus one continuation.
Main restored a matched Daemon with no active/queued Task.

Measured continuation:

- run `codex-run:01a0123b-211a-70e0-a743-e947e6985dec`
- same exact single command and no other ForkLight call
- same pre-admission failure; no Task id or durable delivery stage
- counters: 46,312 input, 33,280 cache read, zero cache creation, 484 output
- gross: 46,796

Total retained delegated pre-admission gross is 93,162. These counters cannot be omitted from any
future episode. They are not persisted as a role sample because there is no Task identity to bind.

## Root cause and product response

The second run disproved the initial hypothesis that only an absent host Daemon caused the failure.
A matched host Daemon was running, but the Codex `workspace-write` sandbox could not connect to the
Unix socket. ForkLight bootstrap received `EPERM`; the then-active Daemon start path collapsed
permission denial, timeout and explicit `ECONNREFUSED` into one false value, treated the endpoint as
stale, unlinked it and then failed to listen. Two live Daemon processes were left without a socket.

Main exact-checked and terminated only those two orphan Daemon PIDs, then restored one matched
Daemon. The separate accepted product Work Item
`specs/m4-e-main-efficient-delivery/work-items/daemon-socket-probe-permission-safety/spec.md`
delivered the fail-closed fix. That product delivery does not retroactively create the missing Task
or authorize another comparison dispatch.

## Stop, handoff and disposition

The accepted pair Spec permits no further pre-admission continuation or replacement after the
repeated failure. Preserve both comparison roots, the direct artifact and all three terminal events.
Do not copy an incomplete artifact, record samples, assess scope/quality, update the canonical pair
report, reclaim the roots or admit Hub.

Any later comparison requires a new explicit Main decision that changes the no-replacement stop
boundary and defines how measured Codex can access only the local ForkLight socket. The old valid
154,171-direct / 553,038-delegated negative remains canonical contrary evidence.

## Read-only next-decision feasibility audit

No stopped root, Task, sample, comparison or artifact was changed by this audit. Fresh serial
storage previews identify a possible **different** current subject if 一骏 later revokes the stop:

- `2d774265-344f-43ea-8f69-79e2624765d3` remains
  `protected / unresolved-partial / protect-and-wait`, with 142,781,211 regenerable bytes,
  5,515,895 durable bytes, zero unknown bytes and no owned process;
- `6676be3a-24b4-4bbc-a8c0-7f2a3079e848` remains
  `reclaimable / integration-delivered / confirm-reclaim`, with 159,988,810 regenerable bytes,
  13,865,918 durable bytes, zero unknown bytes and no owned process;
- newly delivered Daemon repair Task `b664e69e-ee30-4268-8de3-1f7c07fb808d` is
  `reclaimable / integration-delivered / confirm-reclaim`, with 147,589,524 regenerable bytes,
  6,735,929 durable bytes, zero unknown bytes and no owned process.

All three previews report SQLite `quickCheck: ok` and zero foreign-key violations. The possible
subject replaces old comparison Task `4709...` with the newly delivered `b664...`; it cannot reuse
the stopped direct sample or any old delegated event. No reclaim ran.

The existing public delivery contract also permits a smaller measured-Main boundary without a
product change. A deterministic host can submit the already accepted Task, wait for Worker and
independent verification, create the frozen two-Judge Review Graph and wait for terminal Judge
truth. These operations choose no semantic verdict. Exactly one measured Codex Main session can
then re-enter `delivery prepare --task` to read the exact Candidate/diff/Judge packet and, only if it
judges the closed contract satisfied, call `delivery decide accept` bound to the exact Revision and
digest. Source and tests prove `prepare` records no Main review or Integration; `decide` is the sole
path that records Main's verdict and may start safe Integration.

The two failed runs added ForkLight Home as writable but omitted the successful harness's
`sandbox_workspace_write.network_access=true`, so their sandbox denied the local Unix socket. The
current Codex configuration reference documents that flag and additional workspace-write roots:
`https://learn.chatgpt.com/docs/config-file/config-reference`. A later accepted runner can reuse the
already successful M4-E boundary: `workspace-write`, only the isolated comparison root plus the
exact ForkLight Home writable, command network enabled for the local control-plane call, and no
source-project writable root, full-access or bypass mode. Current `codex exec` does not expose the
more targeted `codex sandbox --allow-unix-socket` option, so introducing an unproved permission-
profile mechanism solely for this pair is not proposed.

This is decision preparation, not authorization. Starting a new direct run, ForkLight Task,
measured session, sample or comparison still requires an explicit revocation of the stopped Work
Item's no-replacement boundary. The old failed roots and all 93,162 delegated pre-admission Tokens
remain immutable contrary evidence.
