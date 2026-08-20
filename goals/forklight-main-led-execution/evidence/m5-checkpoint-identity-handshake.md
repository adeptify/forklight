# M5 checkpoint identity-handshake release evidence

Date: 2026-08-21 (Asia/Shanghai)

## Result

The pre-commit release blocker is closed without weakening its timing assertion or mutation safety.
Mutating `daemonRequest()` calls now perform one explicit lightweight `identity` preflight, compare
the response-envelope build/protocol identity, and only then send the actual mutation. The Daemon's
independent before-dispatch identity guard remains unchanged. Explicit `health` still returns the
complete Runtime, Provider and operational projection.

## Root-cause evidence

- Original full-suite checkpoint start exchange: 1,306 ms against `< 1,000 ms`.
- Purposeful focused reproduction: 1,693 ms against the same unchanged assertion.
- Main's cold-Daemon segmented fixture: full `health` preflight about 562 ms; actual
  `checkpoint_start` exchange about 1.7 ms and immediately `running` while `sleep 1` stayed in the
  background.
- Root cause: mutation compatibility reused complete environment health instead of a
  single-responsibility identity projection.

## ForkLight delivery chain

- Task: `3971252c-a6dc-4ca9-a830-6846f7278e86`.
- Runtime truth: Grok 4.6 Xhigh, `grok-build`, `native-goal`, one Attempt, no retry or correction.
- Exact Candidate Revision: `045796d9-8486-4e16-a2d4-126ad3a142c4`.
- Exact digest: `75defc38f686e3ff10ab44ba1dc71e94cb5cf4a039315076fd5eb74591fa4b26`.
- Candidate: four allowed paths, 130 changed lines; no generated output, Store mutation, commit or
  push.
- Independent verification: build passed; checkpoint operation tests 13/13; focused identity tests
  2/2; `git diff --check` passed.
- Review Graph: `77cdce50-525c-48f6-b94e-011ba7d4741c`.
- Judges: Codex Luna Max and DeepSeek Pro 1M both returned usable `accept`; no Blocker/P1.
- Main accepted the exact verified Revision after line-by-line diff review.
- Preflight receipt: `387e0018-55ed-4b6b-9a07-5fd0227ad22a`, no rejection.
- Integration: `632c0b08-c07d-4440-8263-2eb499ffd91b`; source apply, four source checks,
  artifact build, Daemon activation and matched identity all passed.

## Final release verification

`npm run check` passed 3,181/3,181 after Integration. The unchanged checkpoint end-to-end timing
test passed inside the full concurrent suite. This replaces the earlier red-gate stop with green
publication evidence; it does not change the still-deferred unfamiliar-human M5-C gate.

## Surviving call chains

- Mutation: `daemonRequest(mutating)` → read-only `identity` exchange → build/protocol comparison →
  one actual mutation exchange → Daemon before-dispatch identity guard → operation dispatch.
- Health: explicit `health` exchange → coordinator health → complete Runtime/Provider plus fresh
  operational truth.
- Checkpoint: `checkpoint_start` → durable start evidence → background approved command → bounded
  wait → durable report.

## Remaining boundary

No technical publication blocker remains. M5 still has one deliberately deferred product
graduation dependency: the no-coaching unfamiliar-operator observation in a clean disposable
environment.
