# M5-A1Q — Credential-label-safe same-Judge result repair

## User result

ForkLight no longer discards an otherwise valid Judge opinion merely because it names a credential
field or CLI option such as `--api-key`. Actual secret-shaped values remain blocked. Main can use
the existing one-shot same-Judge repair for the current historical false positive without rerunning
the Candidate, changing Judge identity or adding another Judge.

## Background and evidence

M5-A1 Candidate Revision `f7729c3c-f9ad-45eb-a856-f016c2394200` is byte-identical to the accepted
16-path result and passes build plus 121 focused tests. Review Graph
`57a95e79-bf47-4d2a-99e1-6481f400eb68` has one usable Codex accept. MiniMax Reviewer Task
`ef7063af-1285-4fcf-9ae2-625274678481` also returned strict JSON and proposed accept, but its
summary and findings named `--api-key` and related option labels. The current Review Graph
credential pattern rejects any `API_KEY`/`API-KEY` token even when no value follows, so the
opinion is durably `unsafe-content`.

The current repair path is already one-shot, append-only, same-frozen-Judge, read-only and
summary-only. Its eligibility is intentionally limited to an otherwise-valid overlong summary.
The minimum complete fix reuses that lifecycle: refine output parsing to distinguish labels from
values, then admit a historical `unsafe-content` assignment only when the retained original
result becomes fully valid under the refined parser and contains a known label.

## `depends_on`

- Graduated M2-B Review Graph and one-shot same-Judge summary repair.
- M5-A1 final stop packet:
  `goals/forklight-main-led-execution/evidence/m5-a1-final-judge-stop-decision-packet.md`.
- The immutable current MiniMax assignment, Reviewer Task, raw result and private packet.
- No dependency on Hub UI, A2 or A3.

## Inputs

- Existing bounded Review Result JSON and exact Candidate Revision identity.
- Existing terminal assignment with `failureCode: unsafe-content`.
- Existing frozen Judge Profile/provider/model/runtime/effort and private Review Packet.
- Explicit Main `confirm: true` through the existing repair command.

## Outputs

- Review Result parsing that allows credential labels/options without values but still rejects
  actual secret-shaped values.
- Narrow historical repair eligibility for an otherwise-valid result whose old failure was solely
  a known credential-label false positive.
- The existing same-Judge read-only repair Task and aggregation/gate lifecycle, with truthful
  status and no new assignment.
- Focused security regressions and one real post-activation repair of the current MiniMax
  assignment.

## Accepted design and call chain

1. Split the current broad credential pattern into safe-label recognition and actual-value
   rejection. Bare names and CLI options are safe; value-bearing forms, secret-shaped tokens,
   authorization headers and password assignments remain unsafe.
2. Ordinary new Judge results use the refined strict parser. A label-only result is accepted
   directly; any actual secret shape still returns `unsafe-content`.
3. Existing overlong-summary repair behavior remains unchanged.
4. For a historical failed assignment, allow `unsafe-content` repair only when:
   - the original Reviewer Task succeeded and no repair exists;
   - the retained raw JSON now passes the complete strict parser;
   - it contains at least one recognized credential label;
   - the assignment still belongs to the exact Candidate/Graph/Revision and private packet.
5. Reuse the same frozen Judge repair Task. The repair may change only `summary`; exact
   schemaVersion, Revision, disposition and every finding remain equal. Original failure evidence
   remains immutable.
6. Successful repair updates effective Graph evidence and requires a fresh Main decision. It never
   integrates automatically.

## Allowed product paths

- `src/core/review-graph.ts`
- `src/core/review-result-repair.ts`
- `src/core/types.ts` only if a focused typed reason is required
- `tests/review-graph.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`
- `tests/integration.test.ts` only for the effective two-opinion gate
- `docs/operations.md` only if the existing repair command description must change

Main alone updates this spec, Goal SSOT, operational Task and evidence.

## Forbidden paths and non-goals

- M5-A1 Candidate paths, Candidate rerun/edit/revision, new Review Graph/assignment/Judge,
  replacement or third Judge, changed Judge identity, vote or reduced Judge requirement.
- Allowing actual secret values, silent redaction/truncation, arbitrary unsafe-content repair,
  changes to disposition/findings/Revision, automatic repair/retry or generic re-review.
- Store schema/entity changes, locks, leases, checksums, hashes, version handshakes, multi-user or
  distributed coordination.
- Hub UI, A2/A3, Main decision, automatic Integration, commit, push, reset or reclaim.

## Acceptance

1. Bare labels/options such as `--api-key`, `API_KEY` and `api-key` are safe in bounded Review
   Result text.
2. Actual secret-shaped values remain unsafe, including provider token shapes, authorization
   values, password assignments and credential-label assignments with an 8+ character value.
3. Malformed JSON, extra fields, stale Revision, absolute evidence path, unsafe value, failed
   Reviewer Task and non-label historical unsafe-content remain ineligible before mutation.
4. Existing 507-character summary repair behavior and all previous one-shot/identity/immutability
   tests remain passing.
5. A simulated durable historical `unsafe-content` assignment with otherwise-valid label-only JSON
   can create exactly one same-identity read-only repair Task; original assignment evidence and
   assignment count do not change.
6. Repair succeeds only when summary changed and exact Revision, schemaVersion, disposition and
   findings match. It produces newer terminal evidence and requires fresh Main review.
7. CLI/MCP/restart/status remain privacy-safe and expose no raw result, packet path, absolute path
   or credential.
8. Actual diff contains no Candidate, Hub UI, Store schema or unrelated refactor.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/review-graph.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts tests/integration.test.ts
git diff --check
```

Each command retains the local 30-minute safety breaker. The Work Item has no absolute duration,
Token or no-progress deadline.

## Review, handoff and workspace disposition

One Grok 4.6 Xhigh native Goal Worker owns the overlapping Core/tests slice. ForkLight independently
runs the accepted commands. Because this changes security filtering and Review/Integration
authority, exactly two different-view read-only Judges review the implementation before Main
serial Integration. No third/replacement Judge is automatic.

Handoff is returned only in the Worker's final response; it names exact changed paths, label/value
cases, historical eligibility proof, unchanged one-shot/identity/gate behavior and verification.
The Worker must not create a handoff, evidence, Goal, decision or progress file. Protect the
Workspace through Integration.
After activation, Main invokes the existing repair command exactly once for assignment
`54805d0d-4a37-4f05-ae68-53cc7ba687e0`, waits for the same MiniMax identity and records a fresh
Main decision on Task `922238a4-ac7c-461f-b37c-2b2384800fee`.

Stop if the repair needs semantic re-review, actual value filtering weakens, paths expand, either
implementation Judge is unusable/blocking, or the one real repair fails. Do not rerun A1 or create
another Judge.

## Authorized fresh recovery after the correction tool loop

On 2026-08-18 一骏 explicitly authorized the minimum continuation recorded in
`goals/forklight-main-led-execution/evidence/m5-a1-credential-label-correction-loop-stop-decision-packet.md`.
This supersedes only the stopped Task's no-replacement boundary for one fresh recovery Task.

The recovery starts from current source and independently implements the accepted behavior in
exactly these three writable paths:

- `src/core/review-graph.ts`
- `src/core/review-result-repair.ts`
- `tests/review-graph.test.ts`

It does not import or treat the failed correction Workspace as a verified Candidate. The prior
Workspace and transcript are evidence only. The fresh Worker may read this Spec and the stop packet,
but must not create or modify any Goal/Spec/evidence/documentation path. The common CLI form where
the credential option is followed by whitespace and an eight-or-more-character value is an explicit
acceptance case; a bare label in prose remains safe.

The recovery has one Grok 4.6 Xhigh native Goal Attempt, no validation repair, Main correction,
reverify, retry, adaptation, fallback or further replacement. ForkLight independently runs the
unchanged commands. Two different-view read-only Judges and Main serial Integration remain required.
Any Worker failure, path expansion, unusable/blocking Judge or real post-activation repair failure
stops A1Q with the Workspace protected.

## Authorized final exact-Candidate recovery

On 2026-08-18 一骏 explicitly superseded the fresh recovery's no-further-replacement boundary for
one final, narrower Task. It reuses verified Revision
`d911b924-3c78-4ca1-bb28-7b2c58c04b15` as a Workspace-local seed with exactly these three paths:

- `src/core/review-graph.ts`
- `src/core/review-result-repair.ts`
- `tests/review-graph.test.ts`

The seed is accepted input, not final delivery. The Worker may change only
`src/core/review-graph.ts` and `tests/review-graph.test.ts` on top of it, solely to require the
repaired `summary` to differ from the retained original and to add a focused regression proving an
unchanged summary fails permanently. It must not redesign the parser, repair lifecycle or existing
tests, and must not create a handoff file. The complete Candidate remains limited to the exact three
seed paths.

The Task has one Grok 4.6 Xhigh current-model-only native Goal Attempt and zero validation repair,
Main correction, reverify, retry, adaptation, fallback or further replacement. ForkLight runs the
same build, five-file focused suite and diff check. Exactly two different-view read-only Judges and
Main serial Integration remain required. Any Task failure, path expansion, unusable/blocking Judge,
Integration failure or live repair failure stops the Work Item with all prior evidence preserved.

## Authorized one-Judge bootstrap delivery exception

On 2026-08-18 一骏 explicitly superseded the final no-replacement boundary for one bootstrap-only
exact-Candidate delivery. This is a narrow delivery exception, not a change to ForkLight's ordinary
high-risk two-Judge policy.

The Task reuses exact verified Revision `364f98ae-741b-452e-b5d1-5bc8100c69d1` as a
Workspace-local three-path seed. The Worker makes no product behavior change and only inspects and
verifies that exact Candidate. Its immutable inputs and outputs are:

- input digest: `99cc6bb9d1c5c952494440e068109b61b5c5495c9565103488588af8e58d1a84`;
- exact paths: `src/core/review-graph.ts`, `src/core/review-result-repair.ts` and
  `tests/review-graph.test.ts`;
- output: one fresh byte-equivalent Candidate Revision with unchanged build, 412-test focused suite
  and diff validation.

For this delivery only, `reviewRequirement.requiredJudges` is `1` and the sole independent Judge is
`codex-luna-max`. Main must record the exception honestly; it must not count or repair the prior
Volcengine assignment, claim two usable opinions, or establish a one-Judge default.

The delivery has one Grok 4.6 Xhigh current-model-only native Goal Attempt and zero validation
repair, Main correction, reverify, retry, adaptation, fallback or further replacement. Any
Candidate byte drift, command failure, unusable/blocking Codex opinion, Main rejection or
Integration failure stops the Work Item. On success, Main serially integrates and activates the
exact Candidate, then invokes the already accepted one-shot repair only for original A1 MiniMax
assignment `54805d0d-4a37-4f05-ae68-53cc7ba687e0`. The final Volcengine assignment remains
unusable and immutable.
