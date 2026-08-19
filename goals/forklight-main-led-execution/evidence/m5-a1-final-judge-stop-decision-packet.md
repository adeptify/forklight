# M5-A1 final Judge stop decision packet

Date: 2026-08-18 (Asia/Shanghai)

## Completed output

Final Task `922238a4-ac7c-461f-b37c-2b2384800fee` completed one Grok 4.6 Xhigh native Goal without
repair, correction or fallback. ForkLight passed the executable-wrapper policy, build, all 121
focused tests and diff validation. Revision `f7729c3c-f9ad-45eb-a856-f016c2394200`, digest
`dd4f30324cb460ff4d82657008e23ac2bfbf00c3ee7a6247438ff8fd93ca7299`, is byte-identical to the
already accepted exact 16-path Candidate.

Review Graph `57a95e79-bf47-4d2a-99e1-6481f400eb68` retained a usable Codex Luna Max `accept`.
MiniMax Task `ef7063af-1285-4fcf-9ae2-625274678481` also returned a structured `accept`, but its
human summary mentioned the harmless CLI option name `--api-key`. The current credential pattern
treats that option label itself as unsafe content, so the opinion is durably unusable.

Main rejected the delivery Task, not the reusable product Candidate. No Integration occurred.

## Real remaining gap

This is now a repeated product-level false positive: two different M5 Judge outputs proposed accept
but were discarded because they repeated a credential field/option name rather than an actual
credential value. The frozen Graph cannot add/replace a Judge. The existing same-Judge result repair
admits only an otherwise-valid overlong summary and cannot repair `unsafe-content`.

The hard two-opinion gate remains correct and must not be reduced to one. Re-running the same
Candidate without fixing this parser/repair gap can repeat the same failure and violates the final
Task's stop boundary.

## Reusable paths and evidence

- Exact Candidate: protected Task `922238a4-ac7c-461f-b37c-2b2384800fee`, Revision
  `f7729c3c-f9ad-45eb-a856-f016c2394200`.
- Product acceptance: build, 121/121 focused tests and diff validation passed at verification
  sequence `2908`.
- Independent evidence: one usable Codex accept; MiniMax's original Task/output remains immutable.
- Source project: no A1 Integration. Hub UI, A2 and A3 remain unstarted.

## Recommended decision

Create a separate focused quality-chain Work Item that permits one same-Judge schema-only rewrite
when an otherwise-valid result is rejected solely for a known credential *label* such as the CLI
option name, while continuing to reject actual secret-shaped values, authorization headers and
password assignments. It must preserve the same Judge identity, revision, disposition and findings,
remain one-shot, and have focused positive and negative security tests.

After that product fix is independently verified, reviewed and safely integrated, use the new
one-shot repair on the current MiniMax assignment, record a fresh Main decision and integrate the
unchanged A1 Candidate. Do not create a replacement Judge, third Judge or another Candidate Task.

This expands beyond the final A1 replacement contract and therefore requires 一骏's explicit
authorization. The alternative is to stop M5 at A1. No commit, push, reset, reclaim or Hub/UI action
occurred.
