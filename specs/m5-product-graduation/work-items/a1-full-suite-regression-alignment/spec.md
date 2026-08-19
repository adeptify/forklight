# M5-A1R — Align legacy full-suite guards with the accepted setup surface

## User result

M5-A1 graduates with a green full repository check. The existing privacy guards continue to
detect leaked credential values and routing-specific internals, while accepting the new public
setup option labels and bounded `setup` status that A1 intentionally introduced.

## Background and problem evidence

M5-A1 Revision `f7729c3c-f9ad-45eb-a856-f016c2394200` passed its accepted build and 121 focused
tests, received two usable independent accepts after the authorized same-Judge label-only repair,
and was safely integrated and activated by operation
`7d75856f-3eee-42b9-9be2-26e6b077e372`.

The subsequent milestone-level `npm run check` exposed exactly two legacy expectation failures:

1. `tests/daemon-cli.test.ts` test `routing CLI help documents --profiles, --family, and
   Competition flags` searches the entire top-level help for the words `endpoint`, `api-key` or
   `keychain`. A1 correctly documents the public setup option `--endpoint` and stdin API-key flow
   elsewhere in that help, so the routing test now rejects a safe label outside its subject.
2. `tests/hub-health-cache.test.ts` test `cache: cached responses do not include credentials, raw
   commands, or new internal fields` still asserts the pre-A1 top-level status key set. A1
   intentionally adds the bounded, privacy-safe `setup` projection, so the old exact list fails.

Both A1 features are already covered by focused setup, rollback and non-disclosure tests. This
Work Item changes no product behavior; it repairs the two stale full-suite guards without deleting
their security purpose.

## `depends_on`

- Integrated and activated M5-A1 and M5-A1Q Candidates.
- The exact two failures from the post-Integration `npm run check` on 2026-08-18.
- No dependency on M5-A2, M5-A3 or Hub redesign.

## Inputs

- Current top-level CLI help containing routing flags and the new public setup option labels.
- Current `/api/status` projection containing the new bounded `setup` member.
- Existing focused A1 setup, rollback and credential non-disclosure coverage.

## Outputs

- A routing-help assertion scoped to routing help content, or an equivalently narrow assertion
  that still rejects routing-specific credential/configuration internals without rejecting safe
  setup labels elsewhere.
- A Hub cache allow-list that includes `setup` and continues to prove cached status contains no
  credential value, raw command, stack trace or unbounded internal field.
- Passing focused tests and full `npm run check`.

## Allowed paths

- `tests/daemon-cli.test.ts`
- `tests/hub-health-cache.test.ts`

Main alone may update this Spec, the Goal SSOT and evidence. The Worker may edit no other path.

## Forbidden paths and non-goals

- Any `src/**`, Hub asset, documentation, setup implementation, Store/schema, runtime, Candidate,
  Integration or operational wrapper change.
- Removing the routing privacy assertion, replacing it with an always-true check, or allowing raw
  credential values merely because option labels are public.
- Broad test cleanup, snapshot rewrites, extra test-count work, multi-user/distributed controls,
  commit, push, reset or workspace reclamation.

## Accepted approach

1. Preserve the routing test's flag-documentation checks.
2. Scope its internal-field privacy assertion to the routing help block (or another precise
   routing-only projection), so public setup labels outside that block do not cause a false
   positive.
3. Add `setup` to the exact top-level cached-status key set and keep all existing secret-value and
   internal-diagnostic checks intact.
4. If needed, add one bounded assertion over the `setup` member's public shape, but do not duplicate
   A1's full setup test suite.
5. Run the two affected test files, the A1 focused suite, `git diff --check`, then the full check.

## Acceptance

1. The routing test still proves `--profiles`, `--family`, `--comp-intent` and `--comp-triggers`
   are documented.
2. Routing help remains free of Provider endpoint/keychain/API-key configuration details; the
   legal setup labels elsewhere in top-level help no longer fail this routing-specific guard.
3. Hub cached status explicitly allows the A1 `setup` projection while retaining exact top-level
   key bounding and credential-value/internal-diagnostic non-disclosure checks.
4. No product or non-test path changes.
5. The two previously failing tests pass, all A1 focused tests pass, and `npm run check` exits 0.
6. The exact diff is reviewed to prove the assertions became more precise rather than weaker.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/daemon-cli.test.ts tests/hub-health-cache.test.ts
node --disable-warning=ExperimentalWarning --test --import tsx tests/cli-setup.test.ts tests/setup-service.test.ts tests/hub-main-install.test.ts tests/main-install-skill.test.ts tests/hub-settings.test.ts
git diff --check
npm run check
```

Each command retains ForkLight's local 30-minute per-command safety breaker. The Work Item has no
absolute wall-clock, Token or no-progress deadline.

## Handoff, review and workspace disposition

One Grok 4.6 Xhigh native Goal Worker owns the exact two-test slice. ForkLight independently runs
all accepted commands. One independent read-only Codex Judge checks that the changed tests preserve
their security meaning and that no product path changed; a second Judge is unnecessary because the
delivery is test-only, deterministic and has a full-suite oracle.

The Worker returns only a final-response handoff naming the two assertions, exact paths and command
results. It creates no handoff file, Spec, Goal, progress, decision or evidence file. Main inspects
and integrates the Candidate serially. Protect the Workspace until Integration. Stop without retry,
correction, fallback or replacement if paths expand, a security assertion must be removed, any
accepted command fails, or the Judge is unusable/blocking.
