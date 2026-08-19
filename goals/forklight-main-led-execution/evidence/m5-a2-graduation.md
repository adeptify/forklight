# M5-A2 — Local backup and recovery graduation

Date: 2026-08-19 (Asia/Shanghai)

## What is now true

A local developer can use the public CLI to preview, create, inspect and restore a self-contained
ForkLight Home backup. The shared local API/MCP surface exposes the lifecycle-safe preview, create
and inspect operations, but deliberately does not expose restore while that process may own the
same Home.

The result explains included durable data, excluded transient and credential state, Store
integrity, impact and one next action. Creation uses SQLite's online backup rather than copying an
active WAL database. It includes unknown ordinary Home entries, does not follow external links,
and publishes no lock, lease, checksum, content hash or cross-machine version protocol.

Restore is a direct stopped-owner CLI lifecycle. It validates manifest readability, link
containment and SQLite `quick_check`/foreign keys in a sibling stage; observes Daemon and Hub again
immediately before moving Home; keeps the previous Home as a named recovery copy; and never kills
or starts an owner. Inspect is byte-read-only, including unexpected WAL/SHM sidecars. If activation
and automatic rollback both fail, the result does not claim success and keeps the recovery and
staging paths for investigation.

## Delivery lineage

- Work Item: `specs/m5-product-graduation/work-items/local-backup-recovery/spec.md`
- ForkLight Task: `9c5e67ed-86f3-417b-acce-c153ffab1360`
- Worker: Grok CLI 4.6 Xhigh under the truthful ForkLight `native-goal` execution mode
- Final Candidate Revision: `53432923-6a6a-44c6-8e38-5b603077706b`
- Candidate digest: `0fda88f701b0625c8ff5dbf15464807ad8889561958d3d9b321354f0064484f7`
- Candidate boundary: 15 accepted paths, 2,586 changed lines, no Hub UI path
- Final Review Graph: `8822aa98-c625-447f-a313-a8916abe2d39`
- Preflight receipt: `b61b28a4-7d6b-4bb2-b054-3f1f4c87d835`, zero rejection
- Integration operation: `c0d6ae71-ccde-48c8-a9eb-fe532beac375`, `completed/applied`

The base native Goal completed as `complete + achieved`. One allowed Worker validation-repair
successor fixed two real failing acceptance cases, and one allowed Main correction successor fixed
two contract defects found in scoped review: inspect was deleting sidecars, and restore did not
re-observe a late owner before the Home switch. The final successor also added the accepted
double-rename failure proof. All three native Goals remained in the same persistent ForkLight
Session and completed as `complete + achieved`; their reported high-water Worker Token counts were
624,066, 585,271 and 527,507. ForkLight has no official Provider cost quote because terminal billing
usage was unavailable, so no cost or saving is invented.

The pre-correction Review Graph and its historical failures remain durable but were not used to
integrate the corrected Revision. The fresh final Graph has two usable independent `accept`
opinions: Codex Luna Max returned a direct usable result; MiniMax M3's otherwise-valid accept first
violated the output schema, then the single eligible same-Judge result repair Task
`ff038da8-fe5c-4c75-87c2-2e78cfae158e` made that same frozen opinion usable. No Candidate rerun,
identity switch or third Judge occurred. Main then recorded a fresh exact-Revision accept and used
the normal serial Integration path.

## Verification

ForkLight independently passed the accepted Candidate commands:

- `npm run build`
- the five-file focused suite: 386/386 tests
- `git diff --check`

After Integration, source `npm run check` passed 3,140/3,140. A separate post-Integration run of
`tests/local-backup-recovery.test.ts` passed 14/14, including the temp-Home byte round trip,
external-link exclusion, read-only inspect, late-owner refusal and activation-plus-rollback failure.
The real current Home was never restored or replaced. `git diff --check` passed. The restarted
Daemon and client now match build
`e2a535ab036d9381f7f5d4cbf43e4ae6b228d835139b6b2e8db92268085b91fd`; Grok 4.6 Xhigh remains
launchable and resolves to `native-goal`.

## Boundary and next work

M5-A2 is graduated. The Candidate Workspace remains protected through the completed delivery
record; only regenerable Task space may later be reclaimed through the ordinary audited product
lifecycle. No commit, push, reset, real-Home restore or Hub UI change occurred.

M5-A3 clean-clone real delivery is now the sole ready serial Work Item. It must consume the
activated A1 setup and A2 backup contracts before M5-B Hub implementation can start.
