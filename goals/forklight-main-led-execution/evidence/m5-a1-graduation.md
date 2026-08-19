# M5-A1 graduation — no-Hub CLI/API setup

Date: 2026-08-19 (Asia/Shanghai)

## Result

M5-A1 is graduated. A packaged local developer can inspect setup readiness, select a signed-in or
API-key Provider safely, choose a built-in Worker and install/status/uninstall supported Main
surfaces through public CLI/API behavior without opening the incumbent Hub or editing a settings
file. Credential values remain stdin-only and absent from public results.

The final source is the serial Integration of three accepted slices:

1. a narrowly authorized bootstrap delivery for the Review Result label/value distinction required
   to unblock ForkLight's own high-risk upgrade;
2. the original complete 16-path A1 Candidate and its same-frozen-MiniMax label-only result repair;
3. a two-test full-suite expectation alignment that preserved the privacy guards while accepting
   the new public setup surface.

## A1Q bootstrap truth

- Bootstrap Task: `67467033-b84e-44b4-baa2-2ce5f4a0514a`
- Exact Revision: `8d78a037-e114-44d6-a5be-ad24a5555ce3`
- Digest: `99cc6bb9d1c5c952494440e068109b61b5c5495c9565103488588af8e58d1a84`
- Paths: `src/core/review-graph.ts`, `src/core/review-result-repair.ts`,
  `tests/review-graph.test.ts`
- Independent acceptance: bootstrap policy, build, 412 focused tests and diff validation passed.
- Review Graph: `6b433a16-b632-42b6-8ef6-2165f2cd93a1`; one usable Codex accept from Reviewer Task
  `6c427644-602e-41a6-9cf0-b6aa6fc8d91f`.
- Integration receipt/operation: `613f1024-c2ac-49e6-8823-9139b1a14152` /
  `468f36b0-0182-4bde-b05d-675c2e70836c`, completed through activation.

This was the explicitly authorized one-Judge bootstrap exception recorded in the accepted A1Q
Spec. It is not reported as two opinions, does not make the rejected Volcengine result usable and
does not alter ForkLight's ordinary high-risk two-Judge policy.

## Original A1 delivery truth

- Task: `922238a4-ac7c-461f-b37c-2b2384800fee`
- Exact Revision: `f7729c3c-f9ad-45eb-a856-f016c2394200`
- Digest: `dd4f30324cb460ff4d82657008e23ac2bfbf00c3ee7a6247438ff8fd93ca7299`
- Independent acceptance: build, all 121 focused tests and diff validation passed.
- Review Graph: `57a95e79-bf47-4d2a-99e1-6481f400eb68`.
- The original Codex opinion remained usable. The same frozen MiniMax assignment
  `54805d0d-4a37-4f05-ae68-53cc7ba687e0` was repaired exactly once by Task
  `d423dd9d-f0b3-40d3-ba6d-580cc3d76f47`; the original failure remained durable while the Graph
  reached two usable accepts and `agreement`.
- Integration receipt/operation: `ea7cbaba-dfcd-4459-bef6-ff3c6e748e4e` /
  `7d75856f-3eee-42b9-9be2-26e6b077e372`, completed through activation.

No Candidate rerun, replacement Judge, third Judge or automatic retry was used for this repair.

## Full-suite closure

The first post-Integration full check exposed two stale test assumptions rather than product
failures: one routing test scanned unrelated setup help for safe option labels, and one Hub cache
allow-list omitted the new bounded `setup` projection. The accepted test-only Work Item made those
guards precise without removing their credential-value protections.

- Task: `097b7357-fa44-4a53-bfc5-298e416a52b8`
- Revision/digest: `3c376eba-0a95-4920-bd57-73d9932e0076` /
  `bb72e1d9b7fc628f5c9691d5cbdbec259821f15d54d45721e3135f6053ac4f95`
- Exact changed paths: `tests/daemon-cli.test.ts`, `tests/hub-health-cache.test.ts`; 26 changed
  lines and no product path.
- ForkLight independently passed build, the two affected files, the A1 focused suite,
  `git diff --check` and full `npm run check` with 3123/3123 tests.
- Review Graph `afb914b4-a007-4068-9135-4f38697f56f7` retained one usable Codex accept from Reviewer
  Task `bdcf0cc7-6c14-454a-8d95-13846ef0645b`, specifically confirming the assertions were narrowed
  to their intended subject rather than weakened.
- Integration receipt/operation: `f0e91744-65b8-44f4-91bb-f56a257d4846` /
  `a03fbbd3-45cd-4205-b474-d279f8c57351`, completed through activation.

Final `forklight health --json` reports `ok` and matched client/Daemon build identity. No Hub UI,
backup/recovery, A3, commit, push or reset was performed. M5-A2 is now the sole ready serial Work
Item.
