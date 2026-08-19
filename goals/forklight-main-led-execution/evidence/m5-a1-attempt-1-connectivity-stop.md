# M5-A1 Attempt 1 — protected partial after connectivity stop

## Outcome

Task `245a5dec-eb63-4c6b-9971-2e503c55109d` stopped after one real Grok 4.6 Xhigh native Goal because
the Worker lost network connectivity to the Provider before returning its final result. The
Workspace contains meaningful implementation, but no Candidate Revision exists and ForkLight did
not start independent verification, automatic validation repair, Judge review or Integration.

This is neither a failed behavior acceptance nor a successful delivery. The source repository is
unchanged and the complete failed Workspace remains protected.

## Reusable result

The partial changes exactly 16 accepted A1 paths: seven production paths, five focused test paths,
README and three setup/operation documents. It adds the CLI setup command, human readiness
projection, local-sign-in handling, shared Provider API behavior, built-in Worker selection and
Main installation commands. No Hub UI, Store schema, backup/recovery or GoalBoard path changed.

Read-only Main verification inside the protected Workspace:

```text
npm run build
# failed: src/cli/setup.ts has one unused ctx parameter

node --disable-warning=ExperimentalWarning --test --import tsx \
  tests/cli-setup.test.ts tests/setup-service.test.ts tests/hub-main-install.test.ts \
  tests/main-install-skill.test.ts tests/hub-settings.test.ts
# 117 passed / 4 failed
```

All four behavior failures share one cause: selecting a signed-in xAI or OpenAI Provider updates
Provider settings without atomically selecting its compatible Runtime. Existing settings validation
correctly rejects xAI/OpenAI combined with the default `claude-code` Runtime.

## Recovery boundary

The accepted recovery copies exactly the protected 16 paths onto a byte-equal current source base
before a fresh Worker starts. It corrects only:

1. the unused CLI parameter;
2. atomic Provider plus compatible Runtime selection (`xai → grok-build`,
   `openai → codex-cli`; API-key Providers remain on their supported path);
3. focused expectations needed to prove that behavior.

The original Task/Session/Workspace stay immutable. The recovery is one fresh Grok 4.6 Xhigh
native Goal, not a resume. Original acceptance, two different-view Judges and Main serial
Integration remain unchanged. No model switch, Competition, Hub UI, backup/recovery, checksum,
content hash, lock, lease, version handshake, commit, push or reset is admitted.

## Workspace disposition

Protect the failed Workspace until the recovery is integrated or returns a new decision packet.
After delivery, retain this stop record plus exact recovery lineage; only then may normal storage
lifecycle reclaim regenerable space.

## Cross-Task bootstrap stop and Workspace-local replacement

Recovery Task `8835a223-117b-4066-981c-cf583e063037` stopped before any model turn. Its bootstrap
attempted to read the protected old Task from the new Task sandbox and received `EPERM`; ForkLight
then reported the native Goal state missing because the child never launched. No product file,
Candidate, verification, cost-bearing model work, Judge or Integration exists for that Task.

The replacement seed is now part of the new Task's own source snapshot at
`execution/m5-wave-1/m5-a1-protected-partial.patch`. A checked bootstrap proves it describes exactly
the accepted 16 paths and uses `git apply --check -p2` before materialization. The seed applies to
the current source base in a read-only preflight. This removes the forbidden cross-Task read without
changing any product or acceptance boundary and without adding hashes, locks or version machinery.
