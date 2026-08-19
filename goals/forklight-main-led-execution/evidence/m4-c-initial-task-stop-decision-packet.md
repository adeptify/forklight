# M4-C initial Task stop and recovery decision packet

Date: 2026-08-17 (Asia/Shanghai)

## Stopped Task

- Task: `89e60adc-d9ca-4560-9940-b423698c51f0`
- Session: `3293796f-c4d3-4b79-90b7-2b9645e0ce13`
- Base Attempt: `b834bb92-f75b-49b8-bdb3-8a39d2b70556`
- Base native Goal: `2b691a5e-f501-4ad8-8e97-b4e4fbf018a4`
- Validation-repair Attempt: `3aec58de-1589-4ce7-93b9-72e7561480fb`
- Validation-repair successor Goal: `afabc627-4c47-4b1b-adfd-512da49733bc`
- Main-correction Attempt: `5b1cc648-a0ac-4984-acc4-1a14fed80a07`

The base Candidate failed build on two exact-optional TypeScript errors and one real CLI argument
parser test. Its one automatic validation repair corrected all three. The successor Goal then
paused `no_progress_paused/Executing` after two classifier runs despite two completed Worker
rounds, so ForkLight correctly refused to infer `complete + achieved` and ran no normal post-Worker
verification.

## Reusable output and exact gap

Main used the Task's one runtime-Workspace reverification without a Worker. Revision
`61dc45c0-e4b2-49c3-95db-f54a3a4d7861`, digest
`6f7d174e5c1efdb4d859902e3a25edcd51f16933cba5a77d5e637a211a8a5687`, contains exactly ten
approved files and 1,891 changed lines. Build passed, 342/343 focused tests passed and
`git diff --check` passed at verification sequence `7034`.

The sole failure is a new test that extracts a bounded CLI source substring and expects
`switches.has("--json")` inside it. The substring ends earlier; the real empty/seeded CLI JSON and
human behavior test passes in the same suite. This is a test implementation defect, not missing
product behavior.

Main authorized the one structured correction against that exact Revision and one gap. ForkLight
recorded the grant, but Grok failed before model work because the paused native Goal status was
not a continuable success state. No correction edit or new Candidate was produced. The same native
Goal blocker therefore repeated twice and all original Task repair/reverify/correction authority
is exhausted.

## Disposition and Main decision

The old Task, Workspace, native Goals, three Attempts, two failed Revisions and verification chain
remain immutable and protected. There is no Review Graph, Main accept, Integration or reclaim.

一骏 has explicitly authorized all subsequent Goal tasks and instructed Main to continue. Main
therefore admits one new exact-Candidate test-only recovery, defined at
`specs/m4-c-family-value-report/work-items/exact-candidate-test-only-recovery/spec.md`. It uses a
fresh Grok native Goal, materializes the retained Candidate from its own Workspace seed and changes
only the named test. This is a bounded Main decision after a stop, not an automatic retry. Failure
of that recovery is final for M4-C without another replacement.

Admitted recovery Task: `812df915-788c-463c-8ee0-208d71ff9d58`; Session:
`33d3bbc9-83d0-4663-b06f-2529c4e24481`.
