# M2 storage-read transport and final exact reclaim

## Outcome

M2's final storage gate is complete. ForkLight now observes long real-home audit/preview scans
without the generic 15-second client disconnect, and Main used the activated product path to
reclaim only the six Task ids explicitly authorized by 一骏.

The destructive result is exact: 31 known regenerable targets and 685,377,515 bytes were removed.
All 9,102,847 durable bytes remain readable. There was no partial result, unknown eligible content,
process action, integrity failure, `--all-eligible` call or mutation of another Task.

## Observation delivery

- Implementation Task: `14992906-f3ac-4ff6-8555-e3859792ae88`
- Session: `81db95f9-8856-45f5-88c2-dc7bed5d65a3`
- Attempt: `a400dbdf-b249-4d86-8502-8c77b843d293`
- Grok 4.6 Xhigh native Goal: `6f29c8b8-f47f-4b4d-9f35-1ebc3d73be1c`
- Native truth: `complete/Idle`, classifier `achieved`, 5,126-byte Task-local plan, one Worker round
- Candidate Revision: `20662dd6-0206-434c-9e90-4797996482e1`
- Full digest: `6354907cf0a3003bcb11cc5bb4b2a5a06158ca1519eb929661fb76db432d0134`
- Scope: exactly `src/daemon/client.ts` and `tests/daemon.test.ts`, 23 changed lines
- Independent verification: sequence `1882`; build, focused daemon/CLI/MCP tests and diff check
  passed
- Review Graph: `a9e592b3-77cd-43eb-b38d-145b1869aa2b`; Codex Luna Max and DeepSeek Flash both
  returned usable `accept`
- Main Integration: `8e97d3f9-0c83-43f5-b18d-5ae083ed23e0`; apply, source verification, build and
  activation passed
- Full source check: 2,971/2,971 tests passed; restarted client and Daemon build identities matched

The Candidate only adds `storage_audit` and `storage_preview` to the established long observation
mapping. `storage_retain`, health, Store, server dispatch, classification, deletion and public
schemas are unchanged. There is no retry, replay, cancellation, lock, lease, checksum or new
setting.

## Activated pre-reclaim truth

`forklight storage audit --json` returned normally through the activated CLI:

- 430 known entries: 97 protected, 73 reclaimable and 260 reclaimed;
- zero unknown-orphan entries and zero observed processes;
- SQLite `quickCheck: ok`, foreign-key violations `0`.

Six fresh exact serial previews then returned the frozen authorized scope. Every Task was
`reclaimable/main-resolved-terminal`, `confirm-reclaim`, unknown `0`, process count `0`, integrity
`ok/0`:

| Task | Targets | Regenerable bytes | Durable bytes |
| --- | ---: | ---: | ---: |
| `f5d1142a-6eca-4d4c-8c43-801d0b284056` | 5 | 111,173,349 | 1,935,768 |
| `ed0f3982-1c23-408a-a82f-4bc7ee9c43a5` | 5 | 110,629,983 | 574,778 |
| `03090843-548b-4aec-8271-f5307344b17a` | 5 | 110,833,805 | 686,461 |
| `710135bc-3af5-41da-bc8e-8365c4580f3d` | 5 | 111,180,833 | 3,224,522 |
| `83ac853d-28bc-401c-a234-aed2f34a494e` | 5 | 110,755,275 | 527,901 |
| `827ab13b-40ff-469d-be02-2e0c3e3b9e9b` | 6 | 130,804,270 | 2,153,417 |
| **Total** | **31** | **685,377,515** | **9,102,847** |

## Confirmed reclaim and post-check

Main issued one serial `forklight storage reclaim --task <id> --confirm --json` call per row. Every
response matched the requested Task id, returned `applied: true`, classification `reclaimed`, all
targets `removed`, no process action, `dispositionRecorded: true` and integrity `ok/0`. Removed byte
counts exactly matched the preview table.

The preserved durable categories for every Task are logs, result diff, revisions, source manifest,
generated patch and raw patch. Post-reclaim exact previews classify every Task as
`reclaimed/known-regenerable-removed`, with zero known targets, zero regenerable bytes, zero unknown
bytes, no process and the full 9,102,847 durable bytes still present.

The final global audit reports:

- 430 entries: 97 protected, 67 unrelated reclaimable and 266 reclaimed;
- zero unknown-orphan entries and zero observed processes;
- SQLite `quickCheck: ok`, foreign-key violations `0`;
- 5,196,678 bytes of unknown content remain protected inside known historical roots.

The other 67 reclaimable Tasks were outside the explicit authority and remain untouched. The
removed Workspace, baseline, Runtime Home and verifier artifacts are regenerable by rerunning their
Tasks; ForkLight does not offer an undelete of those directories. Durable logs, source manifests,
patches, revisions and disposition evidence were not deleted and remain the audit/recovery record.

No commit, push or reset occurred. M2 is graduated; M3 has not started and waits for 一骏's explicit
Milestone confirmation.
