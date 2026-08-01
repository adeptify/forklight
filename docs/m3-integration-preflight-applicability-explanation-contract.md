# M3 Integration preflight applicability explanation contract

## User outcome

When an accepted Candidate cannot be applied to the current source, Main and a
non-technical Hub user can immediately understand three separate facts:

1. what happened: the Candidate patch no longer applies cleanly to the current source;
2. what it may mean: the source may have changed or the patch may conflict, without claiming an unproved exact cause;
3. what to do next: preserve the Candidate, compare the affected source with it, reconcile intentionally, then run Preflight again.

Raw `git apply --check` output remains available only as bounded technical
evidence. It must not be the primary explanation and must not authorize an
automatic retry, source mutation, broader scope, raised limits, or Integration.

## Canonical production and consumption

### Integration Core

- Produces a closed, privacy-safe `patch-not-applicable` issue only when the
  real dry-run applicability check exits non-zero.
- Keeps `rejectionReasons` unchanged for audit and compatibility.
- Does not parse stderr to invent a more specific cause.
- The issue carries no absolute path, command, diff, stdout, stderr, credential,
  prompt, or free-form diagnostic.
- Persists the issue in the receipt and the matching durable preflight event.

### CLI

- Consumes the canonical issue.
- Leads with plain `what happened`, `possible meaning`, and `next action` lines.
- Keeps the raw rejection reason after the plain explanation as technical evidence.
- JSON output remains the canonical receipt shape.

### Hub

- Consumes the same canonical issue without parsing `rejectionReasons`.
- Shows the three-part explanation before any raw rejection text.
- Keeps raw rejection text inside the existing collapsed technical disclosure.
- Chinese and English must be independently understandable.
- Other rejection types preserve their current behavior.

## Boundaries

- No automatic Worker launch, retry, correction, handoff, adaptation, source
  change, Task mutation, policy change, Integration apply, commit, or push.
- Do not infer whether source drift was correct, blame the Worker, or call the
  Candidate lost.
- Do not redesign Task Detail or create a second Integration truth source.
- Do not touch Elsewhere, Client-Core, client-app-adeptify, SDK release paths,
  or related consumer/Nexus documentation.
- Preserve legacy receipts without structured issues.

## Acceptance scenarios

### Dry-run conflict

Given a succeeded Task with an accepted Candidate whose patch fails the real
`git apply --check`, Preflight rejects without mutating source and returns one
privacy-safe `patch-not-applicable` issue. Raw tool output remains only in the
existing technical rejection evidence.

### Other rejection

Given a size, status, review, path, or unsupported-patch rejection that never
reaches a failing dry-run check, no applicability issue is fabricated.

### Durable projection

The receipt and `integration.preflight.completed` event carry the exact same
closed issue. Restart-safe reads do not recompute or parse diagnostics.

### Human surfaces

CLI and Hub explain what happened, the uncertain interpretation, and the next
safe action before technical detail. Both languages avoid claiming that a
Worker failed or that retrying unchanged will fix the problem.

## Verification scope

- Core integration behavior and event projection.
- CLI human formatter and JSON compatibility.
- Hub renderer, bilingual copy, legacy fallback, and no raw primary diagnostic.
- Full repository tests, build, Hub JavaScript syntax, and diff hygiene.

