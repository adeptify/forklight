# M4-B Work Item — Valid Main Token pair and quality gate

## User result

ForkLight says how many complete Main Token were used directly versus through delegation only after
one explicit, auditable review proves the work had the same scope, the same acceptance and no worse
delegated quality. Missing or contradictory evidence returns `cannot-determine`; it never produces
a saving claim.

## Background and current evidence

M4-A provides two role-aware complete Main usage samples measured by the same explicit Main profile
and Codex terminal-counter method. Existing direct-Codex review v1 has useful rejection reasons but
does not bind both Main roles or persist the three M4 equivalence/quality gates. The two legacy
accepted calibrations therefore remain historical boundary evidence and cannot graduate an M4
pair.

ForkLight already has canonical current-Revision independent verification, Main accept and
four-stage Integration evidence. This Work Item composes those existing facts with one explicit
pair assessment; it does not invent another delivery authority.

## `depends_on`

- M4-A is integrated and activated.
- The target Task has exactly one complete `direct-main` and one complete `delegated-main` sample
  under the same comparison id.
- Existing current verification, Main review and Integration truth remain authoritative for the
  delegated side.

## Inputs

- target ForkLight Task id and comparison id;
- explicit `confirm: true`;
- exact booleans `sameScope: true`, `sameAcceptance: true` and
  `delegatedQualityNotLower: true` for an accepted pair;
- a bounded direct-verification evidence reference and the exact delegated Integration operation
  id;
- reviewer identity `main-codex`, canonical timestamp and schema version;
- or an explicit rejected assessment with one closed reason:
  `scope-mismatch`, `acceptance-mismatch`, `delegated-quality-lower`, `incomplete-evidence`,
  `incompatible-main-profile` or `duplicate-evidence`.

## Outputs and behavior

- One immutable pair assessment per comparison id. Accepted assessment persists all three positive
  gates and bounded evidence references; rejected assessment persists only the closed rejection
  reason and common identity fields.
- The service re-reads both role samples and the delegated Task. An accepted assessment requires:
  same Task/comparison/class/family/Main profile, complete terminal usage on both sides, current
  independent verification pass, exact current Main accept and completed successful Integration.
- Direct verification remains a Main-attested external evidence reference; ForkLight never invents
  direct quality from Token count or source similarity.
- One canonical read-only pair report returns validity/reasons, direct Main gross Token, delegated
  Main gross Token, signed absolute change (`direct - delegated`), percentage change when the direct
  total is nonzero, exact measurement method/profile and evidence references.
- A saving exists only when the pair is accepted and signed change is positive. Equal or negative
  change is valid evidence but result is `not-lower` or `higher`, never clamped.
- Suggested CLI shape: `forklight main-token assess ... --confirm --json` and
  `forklight main-token pair-report --task-id ... --comparison-id ... --json`; Daemon and MCP share
  the same service.

## Allowed paths

One Grok 4.6 Xhigh native Goal Writer may modify only:

- `src/core/main-token-pair.ts` (new)
- `src/state/store.ts`
- `src/daemon/coordinator.ts`
- `src/daemon/protocol.ts`
- `src/daemon/server.ts`
- `src/cli.ts`
- `src/mcp/server.ts`
- `tests/main-token-pair.test.ts` (new)
- `tests/store.test.ts`
- `tests/daemon.test.ts`
- `tests/daemon-cli.test.ts`
- `tests/mcp.test.ts`

M4-A paths are inputs, not writable unless listed above. Any additional path requires a Spec update.

## Acceptance

1. An accepted pair requires two complete opposite-role samples with the same Task, comparison,
   class, family, Main profile and terminal-counter source; every mismatch fails before persistence.
2. Accepted pair assessment requires all three explicit gates true, a bounded direct-verification
   reference, the exact completed Integration id, current passing independent verification and
   current exact Main accept. Missing/stale/rejected evidence returns a stable reason and no claim.
3. Rejected assessment uses only the closed reason vocabulary. It never exposes free-form content
   and can never become a calibration or saving.
4. Pair report uses only terminal counters. It does not use orchestration exchange ranges, Worker
   Token, configured budgets or Provider cost as a substitute for either Main side.
5. Signed absolute and percentage changes preserve zero/negative results. Division by a zero direct
   baseline is typed unavailable.
6. Legacy direct-Codex sample reviews/publications remain readable but report
   `legacy-pair-contract-missing` for M4 validity unless new M4 samples and assessment exist.
7. Pair assessment does not change Task, review graph, Main review or Integration authority and does
   not start any work.
8. ForkLight independent verification passes. Two different-view Judges inspect pair identity,
   quality gates, stale-evidence rejection and arithmetic; Main integrates only the exact accepted
   Revision.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/main-token-usage.test.ts tests/main-token-pair.test.ts tests/store.test.ts tests/daemon.test.ts tests/daemon-cli.test.ts tests/mcp.test.ts
git diff --check
```

Run `npm run check` after the accepted high-risk Integration.

## Forbidden and non-goals

- No automatic acceptance from matching labels, taskClass, file paths, Candidate digest or Token
  result alone.
- No content hash/checksum, source manifest, lock, lease, cross-node handshake, consensus or
  duplicate consistency service. The exact Task/comparison identity, current Store truth and Main
  assessment are sufficient for one local developer.
- No aggregate family claim, benchmark ranking, automatic calibration Task, model switch,
  Competition, extra Judge, retry, correction, Integration or Hub/UI.
- No weakening the quality gate because Worker usage/cost is unavailable; those are separate M4-C
  transparency fields.
- Stop if delegated quality cannot be proven from current canonical delivery evidence or direct
  verification cannot be explicitly referenced.

## Handoff and workspace disposition

Worker hands off exact paths, assessment/report schemas, every invalidity reason and focused test
results. ForkLight independently verifies, two Judges review read-only, and Main reviews the exact
Revision before serial safe Integration. Protect the Workspace through activated pair-report smoke;
then reclaim only regenerable space under the accepted storage lifecycle while retaining durable
samples, assessment and delivery evidence.
