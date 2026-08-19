# M5-A1 — No-Hub first setup through CLI/API

## User result

A developer who installed the packaged ForkLight tarball can understand readiness and complete the
minimum setup for a real delivery without opening the old Hub, inspecting the database or editing a
settings file. The commands say what is ready, what is missing and the next exact action in plain
language.

## Background and evidence

The current product already has:

- `forklight doctor`, `health`, `settings`, the complete delivery commands and MCP delivery tools;
- transactional Provider setup in `SetupService`;
- authenticated Hub APIs for Provider keys, model/Worker configuration and Main installation;
- built-in Worker Profiles, including `grok-4-6-xhigh`;
- tested Main installers with backup and uninstall behavior.

The public CLI has no usable setup command: `forklight setup` currently tells the user to open the
Hub. Provider credential entry, Main installation and simple Worker selection are therefore still
Hub-dependent. This blocks the mandatory CLI/API-before-Hub order.

## `depends_on`

- M2–M4 graduated product truth.
- Current clean-package install and build-identity verification.
- No dependency on the incumbent Hub UI.

## Inputs

- Current settings, Provider definitions, local Runtime sign-in/readiness and Keychain presence.
- Existing model catalog and built-in Worker Profiles.
- Existing Main installer for Codex, Grok Build and Claude Code.
- For API-key Providers only, a credential supplied through stdin after explicit confirmation.

## Outputs

- A concise `forklight setup status [--json]` view with fact, reason and next action.
- CLI setup actions for choosing an already signed-in Provider, storing an API-key Provider through
  stdin, listing/selecting a built-in Worker Profile, and showing/installing/uninstalling Main
  components.
- Shared setup behavior used by the existing local API rather than a second configuration truth.
- Updated clean-install documentation and focused tests.

## Required command behavior

- `setup status` is read-only and does not start a Provider call, Worker, Task, Hub or paid probe.
- Local-sign-in Providers use their existing Runtime sign-in. They never ask for or invent an API
  key.
- API keys are accepted only from stdin, never an argv value. No secret appears in stdout, stderr,
  JSON, Store, receipts or thrown messages. Existing Keychain rollback behavior is preserved.
- Main installation reports which surface was installed, what existing file was backed up and
  whether a new Main session is needed. Uninstall remains explicit and confirmed.
- The normal first-use path may choose a built-in Worker; it does not require a user to author the
  full advanced policy document. Advanced settings remain available through existing settings/API.
- Errors use the pattern: what happened, why it matters, next action.

Exact subcommand spelling may follow existing CLI conventions, but the resulting `usage()` output,
tests and clean-user documentation must agree and must cover all outputs above.

## Modules and call chain

1. CLI parses one bounded setup action and reads a secret from stdin only when required.
2. The shared setup service resolves current Provider/Runtime truth and performs the existing
   transactional Keychain/settings write or Main installer operation.
3. CLI and the local authenticated API render the same safe result shape; JSON contains no secret.
4. `doctor`/`health` can then verify readiness without a paid probe.

## Allowed paths

- `src/cli.ts`
- `src/cli/**`
- `src/setup/**`
- `src/core/secrets.ts`
- `src/core/providers.ts`
- `src/core/settings.ts`
- `src/core/worker-profiles.ts`
- `src/hub/main-install.ts`
- setup-only routes in `src/hub/server.ts`; no HTML, CSS, client JavaScript or navigation changes
- `tests/cli-setup.test.ts`
- `tests/setup-service.test.ts`
- setup-focused cases in `tests/hub-settings.test.ts`, `tests/hub-main-install.test.ts` and
  `tests/main-install-skill.test.ts`
- `README.md`, `docs/configuration.md`, `docs/operations.md`, `docs/m1-clean-user-runbook.md`

## Forbidden paths and non-goals

- Hub UI assets, GoalBoard, Task/Attempt/Candidate/Integration semantics, StateStore schema, backup
  and restore, Provider credentials or real Main config during tests.
- A second settings database, automatic Provider probe, automatic Task, automatic retry,
  multi-user roles, lock, lease, checksum or version handshake.
- Commit, push, reset or writes outside the isolated Workspace.

## Acceptance

- A clean settings home exposes one human-readable readiness summary and one unambiguous next step.
- Local Grok/Codex sign-in and API-key Provider paths are distinguished correctly.
- Credential tests prove stdin-only transport, content-free argv, no output/Store leak, rollback on
  settings failure and no overwrite when the existing Keychain item is unreadable.
- A built-in Worker can be listed and selected without editing a file; invalid ids do not mutate
  settings.
- Main status/install/uninstall use existing safe backups and reject unsupported clients/components.
- Existing authenticated setup API behavior stays compatible and consumes the shared semantics.
- Existing `doctor`, `health`, settings, Hub server and Main installer tests remain passing.
- Actual diff contains no Hub UI work or unrelated refactor.

## Verification commands

```text
npm run build
node --disable-warning=ExperimentalWarning --test --import tsx tests/cli-setup.test.ts tests/setup-service.test.ts tests/hub-main-install.test.ts tests/main-install-skill.test.ts tests/hub-settings.test.ts
git diff --check
```

Each acceptance command may run for up to the existing local 30-minute command safety breaker. The
Work Item itself has no absolute duration, Token or no-progress deadline.

## Handoff and workspace disposition

Handoff names the final commands, shared service entry points, secret-redaction tests, Main-install
backup behavior, focused results and any setup behavior intentionally left advanced. ForkLight
keeps the full Workspace through verification, Judge and Main review. After accepted Integration,
retain the Candidate/review/Integration evidence and reclaim regenerable Workspace/runtime caches
through the normal storage lifecycle.

## Accepted recovery after Attempt 1 connectivity stop

Task `245a5dec-eb63-4c6b-9971-2e503c55109d` ran one Grok 4.6 Xhigh native Goal and produced a
protected exact 16-path Workspace partial, but the Provider connection failed before the Worker
returned normally. ForkLight therefore generated no Candidate and ran no independent acceptance,
validation repair, Judge or Integration. The failed Task, Session and Workspace remain immutable.

Main's read-only acceptance against that Workspace proves:

- 117/121 focused behavior tests pass;
- build has one unused-parameter error in the new CLI setup module;
- four tests expose one product defect: signed-in xAI/OpenAI selection updates the Provider but not
  the compatible Runtime, so existing settings validation correctly rejects `xai + claude-code`
  and `openai + claude-code`.

One fresh recovery Task may copy exactly those 16 changed paths onto a byte-equal source base before
Grok starts, fix only the compile error and Provider/Runtime atomic selection, and run the unchanged
acceptance. The bootstrap uses direct byte comparison only to prevent a wrong source base or wrong
partial; it adds no manifest, checksum, content hash, lock or version handshake. The recovery uses
one fresh Grok 4.6 Xhigh native Goal, the same two-Judge requirement and Main serial Integration.
It does not resume or relabel the failed Goal and does not widen A1.

The first recovery admission, Task `8835a223-117b-4066-981c-cf583e063037`, proved why a direct
cross-Task copy is not legal: ForkLight's Workspace sandbox denied the old Task path with `EPERM`
before Grok received the Goal. It created no model work, Candidate or Workspace product change.
The accepted replacement carries the same exact 16-path partial as a Workspace-local patch in the
Task source snapshot, validates the exact path set and runs `git apply --check` before applying it.
This changes only the operational materialization method; product gaps, acceptance, Runtime, Judge
and Integration boundaries remain unchanged.


## Accepted exact-Candidate delivery replacement after unusable Judge output

Workspace-local recovery Task `088d5506-0b79-4de9-bd6d-e230b115b245` completed one Grok 4.6 Xhigh
native Goal and captured exact Revision `56181554-d009-436b-96a9-1208ea236e87`, digest
`dd4f30324cb460ff4d82657008e23ac2bfbf00c3ee7a6247438ff8fd93ca7299`. ForkLight independently
passed the bootstrap policy, build, all 121 focused tests and diff validation. Main inspected and
accepted the real 16-path diff.

Its two-Judge Graph retained one usable Codex `accept`; the DeepSeek Task also proposed accept but
its result was rejected as `unsafe-content`. The frozen Graph cannot add or replace a Judge, and
the same-Judge repair is correctly limited to an otherwise-valid overlong summary. Integration
preflight therefore rejected fewer than the required two usable opinions.

One bounded delivery replacement may materialize exactly the accepted Candidate from its Task-local
source snapshot, run the unchanged acceptance and produce a fresh Revision without rewriting
passing behavior. It uses one Grok 4.6 Xhigh native Goal, exactly two new different-view read-only
Judges and Main serial Integration. It has one Attempt and zero repair, correction, reverify,
adaptation, fallback, model switch, Competition, third Judge or Judge replacement. Any changed
acceptance or unusable/blocking new Judge stops A1 without another automatic replacement. Exact
evidence is `goals/forklight-main-led-execution/evidence/m5-a1-judge-evidence-stop.md`.

## Explicit final wrapper-mode-only continuation

After Main reported the non-executable-wrapper stop, 一骏 explicitly said to continue. This revokes
only the no-further-replacement boundary for one final wrapper-mode-only Task. The accepted
Candidate, 16-path ownership, A1 behavior and verification commands remain unchanged.

The sole operational delta is mode `0755` on the existing Task-local Runtime wrapper plus a focused
preflight assertion that the configured wrapper is executable. The Task has one Attempt and zero
validation repair, correction, reverify, adaptation, fallback, model switch, Competition, third
Judge, Judge replacement or further replacement. It runs Grok 4.6 Xhigh native Goal, exactly two
fresh different-view read-only Judges and Main serial Integration. Any failure stops A1.

## Final stop at repeated harmless-label Judge rejection

The final Task completed Grok native Goal and unchanged acceptance with exact digest
`dd4f30324cb4...`. Codex returned one usable accept. MiniMax also returned structured accept, but
its summary repeated the harmless CLI option name `--api-key`; the current credential pattern
classified that label as `unsafe-content`. The two-opinion gate therefore remains unsatisfied.
Main rejected delivery without rejecting the reusable Candidate. No Integration occurred.

This is terminal under the final Task contract. Do not create another Candidate Task, Judge,
replacement or retry. A separate quality-chain Work Item that distinguishes credential labels from
actual credential values and extends the same-Judge one-shot repair is the recommended continuation,
but it expands A1 and requires explicit authorization. Exact packet:
`goals/forklight-main-led-execution/evidence/m5-a1-final-judge-stop-decision-packet.md`.

一骏 then explicitly said to continue. The accepted separate Work Item is
`specs/m5-product-graduation/work-items/credential-label-judge-repair/spec.md`. It must first
integrate independently, then repair the current MiniMax assignment once through the existing
same-Judge command. No A1 Candidate rerun or new Judge is authorized.
