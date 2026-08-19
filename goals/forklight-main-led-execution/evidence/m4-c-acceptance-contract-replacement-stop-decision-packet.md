# M4-C acceptance-contract-only replacement stop decision packet

Date: 2026-08-17 (Asia/Shanghai)

## Result now true

The one authorized acceptance-contract-only replacement did not graduate M4-C. ForkLight Task
`4a967967-ac35-48e0-b89a-fd1e7c636e5d`, Session
`e7d111ff-afce-49e6-a7d7-ccbd73e64aac`, is terminal `failed`; no Review Graph, Main accept or
Integration exists. M4-D remains dependency-held.

The Task produced Revision `5dd98f60-f6a1-42c7-86fa-a75c3ef2c7cf`, digest
`d7327f8c6a0ccd5232b950af4a2ed59143f2c0ef81c846d5287c6305352d92ab`, ten paths and 1,925 changed
lines. The digest is exactly identical to the prior final recovery Revision, proving the read-only
Grok Goal made no Candidate change.

## Verification evidence

Attempt `9b8d99e7-4d11-4573-ac41-04f76b47c0c1` completed far enough for ForkLight independent
verification. It recorded:

- `npm run build`: passed.
- complete approved focused suite: 343/343 passed.
- `git diff --check`: passed.
- Main-owned post-application proof: failed before its reverse checks because it invoked ordinary
  `git diff --name-only` inside the Candidate Workspace.

ForkLight Candidate Workspaces are plain isolated directories, not ordinary Git repositories.
ForkLight's top-level `git diff --check` acceptance command receives its own verifier context, but a
Node child process launched by another acceptance command does not inherit an ordinary repository.
The preflight simulation used a temporary Git repository and therefore did not expose this
difference.

Event `2318` records exact failure attribution as `acceptance-contract / non-model`, bound to
verification event `2315` and the exact Revision. This is not evidence of a Grok or product defect.

## Reusable output and paths not taken

Reusable output is the exact ten-path Candidate above and two independent runs of passing
build/343-test/diff evidence. The Task-local marker and both reverse-apply checks remain a viable
non-Git post-state proof; the failed path-list query is unnecessary because the immutable marker
already contains the exact authorized ten-path set and ForkLight captures the same affected paths
in the Revision.

No Worker repair, Main correction, no-Worker reverify, adaptation, fallback, Judge, Integration or
another replacement ran. Manually applying the Candidate to source or accepting a failed Revision
would bypass ForkLight's safe quality chain and remains forbidden.

## Workspace disposition and remaining decision

All three M4-C Workspaces and Revisions remain protected. Do not reclaim their regenerable content
while the decision is unresolved. Current preview classifies the replacement
`protected / awaiting-required-review`, with zero unknown bytes, no processes and Store integrity
`ok/0`; event inspection and Integration history contain no review, Main-decision or Integration
record.

The accepted replacement spec granted one base Attempt and explicitly set extra Attempt, repair,
correction, reverify, adaptation, fallback and further replacement to zero. That authority is now
consumed. M4-C and therefore M4 remain blocked. Continuing requires a new explicit decision that
supersedes this exact one-shot boundary; broad standing authority does not silently change the
bounded stop rule.

## Subsequent explicit authorization

On 2026-08-18 一骏 explicitly revoked this acceptance replacement's one-shot boundary and
authorized one final non-Git post-state-proof replacement. The accepted successor is
`specs/m4-c-family-value-report/work-items/non-git-post-state-proof-replacement/spec.md` with one
Attempt and zero retry, reverify, correction, fallback or further replacement. It may reuse the
exact Candidate only through the two accepted Workspace-local patches; its post-state proof may
use the exact marker and reverse `git apply --check`, but must not query repository metadata. This
authorization does not alter the failed Task or its evidence.
